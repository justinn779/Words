// Internal authoring table: one row per category, listing its category id, display
// name, and 10 unambiguous candidate words. categories.ts and words.ts both derive
// their public shape from this single source so the two can never drift out of sync.
//
// Content guidelines followed here (see docs/game-design-decisions.md):
//  - Every word is written to have exactly one obviously-correct category in this
//    dataset, so possibleCategoryIds is a single-item array for all v1 content.
//  - Avoided ambiguous or region-sensitive picks (see spec section 71/72).

export interface SeedRow {
  categoryId: string
  name: string
  words: string[]
}

export const SEED: SeedRow[] = [
  { categoryId: 'fruit', name: '水果', words: ['蘋果', '香蕉', '葡萄', '西瓜', '柳橙', '芒果', '草莓', '鳳梨', '奇異果', '檸檬'] },
  { categoryId: 'animal', name: '動物', words: ['狗', '貓', '大象', '老虎', '獅子', '熊貓', '猴子', '長頸鹿', '斑馬', '兔子'] },
  { categoryId: 'instrument', name: '樂器', words: ['吉他', '鋼琴', '小提琴', '長笛', '薩克斯風', '大提琴', '鼓', '豎琴', '口琴', '直笛'] },
  { categoryId: 'country', name: '國家', words: ['日本', '韓國', '美國', '法國', '德國', '泰國', '義大利', '加拿大', '澳洲', '印度'] },
  { categoryId: 'city', name: '城市', words: ['台北', '東京', '巴黎', '倫敦', '紐約', '首爾', '曼谷', '羅馬', '雪梨', '香港'] },
  { categoryId: 'vehicle', name: '交通工具', words: ['汽車', '公車', '火車', '飛機', '腳踏車', '摩托車', '捷運', '輪船', '計程車', '高鐵'] },
  { categoryId: 'sport', name: '運動', words: ['籃球', '足球', '棒球', '排球', '網球', '桌球', '羽毛球', '游泳', '跑步', '高爾夫'] },
  { categoryId: 'occupation', name: '職業', words: ['醫生', '老師', '工程師', '律師', '廚師', '警察', '消防員', '農夫', '護理師', '會計師'] },
  { categoryId: 'drink', name: '飲料', words: ['咖啡', '紅茶', '綠茶', '牛奶', '果汁', '汽水', '豆漿', '可可', '檸檬水', '氣泡水'] },
  { categoryId: 'dessert', name: '甜點', words: ['蛋糕', '布丁', '冰淇淋', '餅乾', '巧克力', '馬卡龍', '鬆餅', '甜甜圈', '泡芙', '提拉米蘇'] },
  { categoryId: 'marine', name: '海洋生物', words: ['鯨魚', '海豚', '鯊魚', '章魚', '水母', '海龜', '海星', '螃蟹', '龍蝦', '海馬'] },
  { categoryId: 'bird', name: '鳥類', words: ['麻雀', '老鷹', '貓頭鷹', '孔雀', '鴿子', '天鵝', '企鵝', '鸚鵡', '燕子', '烏鴉'] },
  { categoryId: 'insect', name: '昆蟲', words: ['螞蟻', '蝴蝶', '蜜蜂', '蜻蜓', '甲蟲', '瓢蟲', '螳螂', '蟬', '蚊子', '蒼蠅'] },
  { categoryId: 'flower', name: '花卉', words: ['玫瑰', '鬱金香', '向日葵', '櫻花', '百合', '蘭花', '牡丹', '康乃馨', '茉莉', '菊花'] },
  { categoryId: 'furniture', name: '家具', words: ['沙發', '書桌', '椅子', '床', '書架', '衣櫃', '茶几', '餐桌', '屏風', '化妝台'] },
  { categoryId: 'appliance', name: '家電', words: ['冰箱', '洗衣機', '冷氣', '電視', '微波爐', '吸塵器', '電風扇', '烤箱', '電鍋', '除濕機'] },
  { categoryId: 'clothing', name: '衣物', words: ['襯衫', '外套', '褲子', '裙子', '帽子', '手套', '圍巾', '襪子', '皮帶', '領帶'] },
  { categoryId: 'stationery', name: '文具', words: ['鉛筆', '原子筆', '橡皮擦', '尺', '剪刀', '膠水', '筆記本', '迴紋針', '訂書機', '修正帶'] },
  { categoryId: 'weather', name: '天氣', words: ['晴天', '雨天', '陰天', '颱風', '雷電', '下雪', '起霧', '彩虹', '冰雹', '強風'] },
  { categoryId: 'scenery', name: '自然景觀', words: ['高山', '海洋', '湖泊', '瀑布', '峽谷', '沙漠', '森林', '火山', '冰川', '草原'] },
  { categoryId: 'planet', name: '星球', words: ['水星', '金星', '地球', '火星', '木星', '土星', '天王星', '海王星', '月球', '太陽'] },
  { categoryId: 'cuisine', name: '料理', words: ['壽司', '拉麵', '披薩', '咖哩', '火鍋', '牛排', '炒飯', '水餃', '義大利麵', '漢堡'] },
  { categoryId: 'festival', name: '節日', words: ['春節', '中秋節', '端午節', '聖誕節', '情人節', '元宵節', '清明節', '萬聖節', '母親節', '父親節'] },
  { categoryId: 'filmGenre', name: '電影類型', words: ['喜劇片', '動作片', '恐怖片', '愛情片', '科幻片', '動畫片', '懸疑片', '紀錄片', '音樂劇', '戰爭片'] },
  { categoryId: 'musicGenre', name: '音樂類型', words: ['古典樂', '爵士樂', '搖滾樂', '流行樂', '民謠', '電子樂', '嘻哈', '藍調', '歌劇', '饒舌'] },
  { categoryId: 'architecture', name: '建築', words: ['城堡', '教堂', '寺廟', '燈塔', '橋樑', '摩天大樓', '金字塔', '宮殿', '車站', '圖書館'] },
  { categoryId: 'bodyPart', name: '身體部位', words: ['眼睛', '鼻子', '嘴巴', '耳朵', '手臂', '手指', '膝蓋', '肩膀', '頭髮', '腳掌'] },
  { categoryId: 'color', name: '顏色', words: ['紅色', '藍色', '黃色', '綠色', '紫色', '橘色', '黑色', '白色', '灰色', '粉紅色'] },
  { categoryId: 'subject', name: '學科', words: ['數學', '國文', '英文', '歷史', '地理', '物理', '化學', '生物', '音樂', '美術'] },
  { categoryId: 'tool', name: '工具', words: ['螺絲起子', '鐵鎚', '扳手', '鉗子', '鋸子', '尺規', '手電筒', '梯子', '釘子', '膠帶'] },
]
