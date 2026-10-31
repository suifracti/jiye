"""Synthetic, offline checks for optional folder scans and resumable jobs."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class FolderJobsTests(unittest.TestCase):
    def test_source_transient_retry_and_no_miss_cooldown(self):
        from src.sources.base import Source
        class Example(Source):
            def _search(self,title):
                self.request('https://example.invalid/data')
                return {'status':'genuine_not_found'}
        calls=[]
        def transport(*args,**kwargs):
            calls.append(1)
            if len(calls)==1: raise URLError('temporary connection')
            return {}
        with patch('time.sleep'):
            source=Example(enabled=True,min_interval=0,transport=transport)
            self.assertEqual(source.search('Example')['status'],'genuine_not_found')
        self.assertEqual(len(calls),2)
        self.assertEqual(source.retry_at,0)

    def test_builtin_client_opt_in_runtime_token_and_two_retries(self):
        from src.sources.quark import QuarkShareClient, ScanError
        calls=[]
        def transport(url,payload=None,headers=None):
            calls.append((url,payload))
            if len(calls)==1: raise URLError('temporary connection')
            if '/token?' in url:return {'status':200,'code':0,'data':{'stoken':''.join(['synthetic-','runtime-token'])}}
            return {'status':200,'code':0,'data':{'list':[]},'metadata':{'_total':0}}
        client=QuarkShareClient('https://'+'pan.quark.cn'+'/s/'+'SYNTHETIC',enabled=False,transport=transport,min_interval=0)
        with self.assertRaises(ScanError):client.page('0',1,50)
        self.assertFalse(calls)
        client.enabled=True
        with patch('time.sleep'):self.assertEqual(client.page('0',1,50)['data']['list'],[])
        self.assertEqual(len(calls),3)
        self.assertIn('stoken=synthetic-runtime-token',calls[-1][0])

    def test_tree_resume_recursive_split_sizes_and_fresh_next_run(self):
        from src.sources.quark import scan_tree, ScanCache
        calls=[];cancel=[False]
        def loader(fid,page,size):
            calls.append((fid,page))
            items={'0':[{'fid':'work','file_name':'SAMPLE101','file_type':0}],
                   'work':[{'fid':'part1','file_name':'archive.001','file_type':1,'size':1048576},{'fid':'nested','file_name':'extra','file_type':0}],
                   'nested':[{'fid':'part2','file_name':'archive.002','file_type':1,'size':2097152}]}.get(fid,[])
            if fid=='work':cancel[0]=True
            return {'data':{'list':items},'metadata':{'_total':len(items)}}
        with tempfile.TemporaryDirectory() as tmp:
            cache=ScanCache(Path(tmp)/'progress.json')
            first=scan_tree(loader,cache=cache,key='fixture',cancelled=lambda:cancel[0],min_interval=0)
            self.assertFalse(first['complete'])
            self.assertEqual(first['status'],'cancelled')
            cancel[0]=False
            second=scan_tree(loader,cache=cache,key='fixture',min_interval=0)
            self.assertTrue(second['complete'])
            self.assertEqual(second['folders'][0]['size_bytes'],3145728)
            self.assertEqual(calls.count(('0',1)),1)
            cache.forget_completed()
            scan_tree(loader,cache=cache,key='fixture',min_interval=0)
            self.assertEqual(calls.count(('0',1)),2)
            self.assertNotIn('stoken',Path(tmp,'progress.json').read_text())

    def test_health_requires_complete_and_detects_provider_flags(self):
        from src.sources.quark import record_health
        tree={'complete':False,'folders':[],'files':[]}
        self.assertEqual(record_health({'quark_folder_fid':'gone'},tree)['status'],'unknown')
        tree['complete']=True
        self.assertEqual(record_health({'quark_folder_fid':'gone'},tree)['status'],'missing')
        tree['folders']=[{'fid':'work','ban':False,'risk_type':2,'file_count':0,'file_type':0}]
        self.assertEqual(record_health({'quark_folder_fid':'work'},tree)['status'],'banned')
        tree['folders'][0].update(risk_type=0,file_count=0)
        self.assertEqual(record_health({'quark_folder_fid':'work'},tree)['status'],'missing')

    def test_helper_disabled_and_imported_size_preserves_manual(self):
        from src.helper import server
        record={'id':'sample','code':'SAMPLE101','quark_folder_fid':'work'}
        payload={'modules':{'quark':False},'shares':[{'id':'demo','records':[record]}]}
        self.assertEqual(server.job_quark_scan(server.Job('test'),payload)['status'],'disabled')
        listing={'complete':True,'folders':[{'fid':'work','name':'SAMPLE101','path':'/SAMPLE101'}],
                 'files':[{'fid':'part','parent_fid':'work','name':'a.zip','size':1048576}]}
        payload.update(modules={'quark':True},folderListings={'demo':listing})
        result=server.job_quark_sizes(server.Job('test'),payload)
        self.assertEqual(result['sizes']['sample']['size_mb'],1)
        payload['shares'][0]['records'][0]['size_str']='人工大小'
        self.assertNotIn('sample',server.job_quark_sizes(server.Job('test'),payload)['sizes'])

    def test_replacement_ignores_old_manual_match_but_incomplete_is_not_missing(self):
        from src.helper import server
        record={'id':'sample','code':'SAMPLE101','quark_location_manual':True,
                'quark_folder_fid':'old','quark_location_url':'https://example.invalid/old'}
        listing={'complete':True,'folders':[{'fid':'new','name':'SAMPLE101'}],'files':[]}
        payload={'modules':{'quark':True},'shares':[{'id':'demo','records':[record]}],
                 'folderListings':{'demo':listing},'forceRescan':True}
        result=server.job_quark_scan(server.Job('test'),payload)
        self.assertTrue(result['summary'][0]['complete'])
        self.assertEqual(result['records']['sample']['fid'],'new')
        self.assertEqual(record['quark_folder_fid'],'old')
        payload['folderListings']['demo']={'complete':False,'folders':[]}
        result=server.job_quark_scan(server.Job('test'),payload)
        self.assertFalse(result['summary'][0]['complete'])
        self.assertEqual(result['records']['sample']['status'],'unknown')

    def test_incomplete_pagination_cannot_conclude_missing(self):
        from src.sources.quark import scan_tree, record_health
        def loader(fid,page,size):return {'data':{'list':[]},'metadata':{'_total':1}}
        tree=scan_tree(loader,min_interval=0)
        self.assertFalse(tree['complete'])
        self.assertEqual(tree['status'],'incomplete')
        self.assertEqual(record_health({'quark_folder_fid':'missing'},tree)['status'],'unknown')

class FailureSummaryTests(unittest.TestCase):
    def test_reference_five_consecutive_records_then_skips_without_not_found(self):
        from src.helper import ref_sites
        class Offline:
            calls=0
            def json(self,url):self.calls+=1;raise OSError('offline fixture')
        client=Offline();records=[{'id':f'sample-{i}','name':'示例标题'} for i in range(7)]
        result=ref_sites.find_covers(records,[{'id':'sample','url':'https://example.invalid','lastCheck':{'status':'failed'}}],client)
        self.assertEqual(client.calls,5)
        self.assertEqual(result['stats']['notFound'],0)
        self.assertEqual(result['stats']['networkFailed'],7)
        self.assertEqual(result['siteFailures'][0]['count'],5)
        self.assertEqual(result['siteFailures'][0]['skipped'],2)

    def test_reference_one_failed_record_recovers_and_blocked_stops_immediately(self):
        from src.helper import ref_sites
        class Recover:
            calls=0
            def json(self,url):
                self.calls+=1
                if self.calls==1:raise OSError('offline fixture')
                return []
        records=[{'id':f'sample-{i}','name':'示例标题'} for i in range(3)]
        site={'id':'sample','url':'https://example.invalid'}
        result=ref_sites.find_covers(records,[site],Recover())
        self.assertEqual(result['stats']['networkFailed'],1)
        self.assertEqual(result['stats']['notFound'],2)
        class Blocked:
            def json(self,url):raise ref_sites.SiteBlocked('HTTP 429')
        result=ref_sites.find_covers(records,[site],Blocked())
        self.assertEqual(result['siteFailures'][0]['count'],1)
        self.assertEqual(result['siteFailures'][0]['skipped'],2)
        self.assertEqual(result['stats']['notFound'],0)

    def test_source_five_failures_skip_remaining_but_can_retry_next_run(self):
        from src.helper import server
        from src.sources.base import Source, SourceRegistry, result
        class Offline(Source):
            key='sample'
            def _search(self,title):raise OSError('offline fixture')
        records=[{'id':f'sample-{i}','name':'示例标题'} for i in range(7)]
        payload={'records':records,'sources':['sample'],'sourceConfig':{'custom_sources':[{'key':'sample','enabled':True}]}}
        with patch.object(server,'registry_for_payload',return_value=SourceRegistry([Offline(enabled=True)])):
            response=server.job_enrich(server.Job('test'),payload)
        self.assertEqual(response['stats']['network_error'],5)
        self.assertEqual(response['sourceFailures'][0]['skipped'],2)
        self.assertNotIn('genuine_not_found',response['stats'])
        self.assertEqual(len(response['changed']),5)
        self.assertTrue(all(not item['source_checks']['sample']['retry_at'] for item in response['changed'].values()))

    def test_explicit_limits_never_retry_and_share_invalid_is_distinct(self):
        from src.sources.quark import QuarkShareClient, ScanError
        from src.sources.http import retry_request
        for code in (403,429):
            calls=[]
            def blocked():calls.append(1);raise HTTPError('https://example.invalid',code,'limited',{},None)
            with self.assertRaises(HTTPError) as caught:retry_request(blocked)
            caught.exception.close()
            self.assertEqual(len(calls),1)
        client=QuarkShareClient('https://'+'pan.quark.cn'+'/s/'+'SAMPLE',enabled=True,
              transport=lambda *args,**kw:{'status':400,'code':41002,'message':'分享已失效'})
        with self.assertRaises(ScanError) as caught:client.check_share()
        self.assertEqual(caught.exception.status,'invalid_share')

    def test_daily_no_config_is_offline_and_preserves_partial_results(self):
        from src.helper import server
        with patch('urllib.request.urlopen',side_effect=AssertionError('network')):
            result=server.job_daily_routine(server.Job('test'),{'records':[{'id':'sample','name':'示例'}]})
        self.assertEqual(result['status'],'unconfigured')
        self.assertFalse(result['shareChecks'])
        self.assertIsNone(result['quark'])
        self.assertIsNone(result['enrich'])
        self.assertIn('progress',server.Job('test').view())

if __name__=='__main__':unittest.main()
