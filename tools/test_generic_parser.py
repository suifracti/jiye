import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from src.importers.core import extract_game_details,extract_structured_details,parse_size_mb
class Parsing(unittest.TestCase):
 def test_explicit_structured_fields_preserve_title(self):
  row=extract_structured_details('1984 / 读书笔记',version='第二版',tags='文学,读书,文学')
  self.assertEqual(row['title'],'1984 / 读书笔记');self.assertEqual(row['tags'],['文学','读书']);self.assertEqual(row['version'],'第二版')
 def test_text_only_uses_explicit_markers(self):
  row=extract_game_details('城市之光 v2.1 2GB @虚构作者 #电影')
  self.assertEqual(row['title'],'城市之光');self.assertEqual(row['author'],'虚构作者');self.assertEqual(row['size_mb'],2048);self.assertEqual(row['tags'],['电影'])
 def test_title_and_size(self):
  self.assertEqual(extract_game_details('PC时代的阅读')['title'],'PC时代的阅读');self.assertEqual(parse_size_mb('1 TB'),1048576)
if __name__=='__main__':unittest.main()
