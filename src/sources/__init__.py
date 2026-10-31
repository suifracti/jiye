"""Public metadata sources and generic extension hooks."""
from .base import (Source, SourceRegistry, ManualJSONSource, FetchMode, enrich_record,
                   merge_web_info, manual_id_source, record_source_id, source_info,
                   web_links, query_names, title_confidence, source_key, compute_query_fingerprint, record_needs_check)
from .steam import SteamSource
from .bangumi import BangumiSource

def default_registry(config=None,transports=None):
    config=config or {}; transports=transports or {}
    registry=SourceRegistry()
    for key,adapter in (('steam',SteamSource),('bangumi',BangumiSource)):
        options=dict(config.get(key) or {})
        options.setdefault('enabled',False)
        if key in transports: options['transport']=transports[key]
        registry.register(adapter(**options))
    custom=config.get('custom_sources') or []
    if isinstance(custom,dict): custom=[dict(value,key=key) for key,value in custom.items()]
    for entry in custom:
        if isinstance(entry,dict) and entry.get('key'):
            adapter=ManualJSONSource(entry['key'],entry.get('records') or [])
            adapter.enabled=entry.get('enabled') is True
            registry.register(adapter)
    return registry
