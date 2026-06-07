import { z } from "zod";
import type { CaseData } from "@/game/schemas/game";

const homeHeroLimits = {
  caseName: 18,
  headline: 6,
  prompt: 22,
  note: 26,
  signalLabel: 4,
  signalValue: 10,
} as const;

export const homeHeroSignalSchema = z.object({
  label: z.string().min(1).max(homeHeroLimits.signalLabel),
  value: z.string().min(1).max(homeHeroLimits.signalValue),
});

export const homeHeroCopySchema = z.object({
  caseName: z.string().min(2).max(homeHeroLimits.caseName),
  headline: z.string().min(2).max(homeHeroLimits.headline),
  prompt: z.string().min(6).max(homeHeroLimits.prompt),
  note: z.string().min(8).max(homeHeroLimits.note),
  signals: z.array(homeHeroSignalSchema).min(3).max(3),
});

export const homeHeroSidecarSchema = z.object({
  version: z.literal(1),
  cacheId: z.string(),
  caseId: z.string(),
  caseTitle: z.string(),
  coverSrc: z.string().optional(),
  homeHero: homeHeroCopySchema,
  updatedAt: z.string(),
});

export type HomeHeroCopy = z.infer<typeof homeHeroCopySchema>;

export const fallbackHomeHeroCopies = [
  {
    caseName: "雾港冻库停电案",
    headline: "今天事真多",
    prompt: "十分钟黑暗里，谁补了一条门禁？",
    note: "你开口追问，AI 把口供、证据和矛盾推到台前。",
    signals: [
      { label: "门禁", value: "01:36 补录" },
      { label: "监控", value: "七分钟黑屏" },
      { label: "账册", value: "水渍封页" },
    ],
  },
  {
    caseName: "雨夜码头失踪案",
    headline: "口供在闪",
    prompt: "同一场雨里，三个人说出了三种方向。",
    note: "每次追问都会改写现场，别让沉默先结案。",
    signals: [
      { label: "航班", value: "延误 42 分" },
      { label: "脚印", value: "向海而止" },
      { label: "通话", value: "空号回拨" },
    ],
  },
  {
    caseName: "旧楼电梯坠落案",
    headline: "记录会撒谎",
    prompt: "维修单提前签收，事故却晚了六小时发生。",
    note: "从一句含糊其辞开始，把整栋楼的时间线重新钉住。",
    signals: [
      { label: "电梯", value: "B2 异响" },
      { label: "工单", value: "提前签收" },
      { label: "钥匙", value: "少了一把" },
    ],
  },
  {
    caseName: "午夜画廊调包案",
    headline: "真相偏航",
    prompt: "警报没有响，墙上的画却轻了三百克。",
    note: "证词像光一样折射，你要找的是那条偏出去的线。",
    signals: [
      { label: "展柜", value: "封条未破" },
      { label: "称重", value: "-300g" },
      { label: "灯控", value: "2 秒闪断" },
    ],
  },
  {
    caseName: "山庄合约焚毁案",
    headline: "谁改了底稿",
    prompt: "火是凌晨起的，修改时间却停在前一晚。",
    note: "把灰烬、签名和语气拼起来，找到那个提前知道结局的人。",
    signals: [
      { label: "合约", value: "第 7 页缺失" },
      { label: "炉灰", value: "含蜡封" },
      { label: "笔迹", value: "末笔发抖" },
    ],
  },
  {
    caseName: "冷链样本错封案",
    headline: "封条不对",
    prompt: "同一只样本箱，出现了两枚不同批次封签。",
    note: "从标签、温控和交接记录里，找出那段被遮住的路。",
    signals: [
      { label: "封签", value: "批次冲突" },
      { label: "温控", value: "12 分钟回升" },
      { label: "交接", value: "签名缺角" },
    ],
  },
  {
    caseName: "社区水箱异味案",
    headline: "水位说话",
    prompt: "投诉刚撤回，水箱记录却多出一段夜间开启。",
    note: "看似普通的维修单，可能藏着一整条责任链。",
    signals: [
      { label: "水位", value: "反常回落" },
      { label: "维修", value: "夜间登记" },
      { label: "门锁", value: "无破坏痕" },
    ],
  },
  {
    caseName: "校园奖学金篡改案",
    headline: "名单变了",
    prompt: "公示前一小时，排名表被悄悄覆盖。",
    note: "把登录记录、打印痕迹和几句证词并排，谎话会先露边。",
    signals: [
      { label: "名单", value: "二次覆盖" },
      { label: "打印", value: "纸张错批" },
      { label: "账号", value: "异地登录" },
    ],
  },
  {
    caseName: "剧场吊杆误落案",
    headline: "灯灭之后",
    prompt: "彩排暂停三分钟，舞台上多了一道不该有的锁痕。",
    note: "别急着怪设备，先听听每个人停电时站在哪里。",
    signals: [
      { label: "吊杆", value: "锁痕新鲜" },
      { label: "灯控", value: "手动断电" },
      { label: "彩排", value: "三分钟空档" },
    ],
  },
  {
    caseName: "药房短缺登记案",
    headline: "药柜空格",
    prompt: "盘点差一盒，监控却显示没人打开药柜。",
    note: "当记录太完美，反而要从最安静的空格开始查。",
    signals: [
      { label: "药柜", value: "空槽错位" },
      { label: "盘点", value: "少一盒" },
      { label: "监控", value: "角度被挡" },
    ],
  },
  {
    caseName: "电商仓退货调包案",
    headline: "包裹太轻",
    prompt: "扫码重量对不上，退货箱却一路绿灯通过。",
    note: "秤台、封箱胶和异常退款，会把这次调包慢慢拼出来。",
    signals: [
      { label: "称重", value: "-680g" },
      { label: "退货", value: "极速通过" },
      { label: "胶带", value: "二次覆盖" },
    ],
  },
  {
    caseName: "养老院夜班误报案",
    headline: "铃声缺席",
    prompt: "呼叫铃没有响，值班表却提前写好了处理结果。",
    note: "看见被补齐的记录，就要问补的是事实还是借口。",
    signals: [
      { label: "呼叫", value: "无铃声" },
      { label: "夜班", value: "提前填写" },
      { label: "巡房", value: "路线倒置" },
    ],
  },
  {
    caseName: "共享车库刮擦案",
    headline: "车位空了",
    prompt: "车主说没动过车，地锁记录却显示两次升降。",
    note: "从轮胎灰、地锁和出口照片里，找出谁借走了沉默。",
    signals: [
      { label: "地锁", value: "二次升降" },
      { label: "轮胎", value: "灰痕断裂" },
      { label: "出口", value: "车牌模糊" },
    ],
  },
  {
    caseName: "博物馆展签误置案",
    headline: "编号错位",
    prompt: "展品没有移动，说明牌却换到了隔壁展柜。",
    note: "真正被调走的也许不是文物，而是参观路线里的证据。",
    signals: [
      { label: "展签", value: "编号错位" },
      { label: "展柜", value: "湿度稳定" },
      { label: "路线", value: "人流反常" },
    ],
  },
  {
    caseName: "工地钢筋抽检案",
    headline: "样本偏软",
    prompt: "送检编号吻合，切口纹理却不像同一批材料。",
    note: "一根钢筋不会撒谎，撒谎的是把它送到桌上的人。",
    signals: [
      { label: "样本", value: "纹理不符" },
      { label: "送检", value: "编号吻合" },
      { label: "仓单", value: "页码跳号" },
    ],
  },
  {
    caseName: "直播间退款风波",
    headline: "后台眨眼",
    prompt: "主播还在镜头里，退款权限却被人连续调用。",
    note: "把弹幕、后台和仓库出单对齐，热闹背后就会安静下来。",
    signals: [
      { label: "后台", value: "权限连调" },
      { label: "弹幕", value: "刷屏遮挡" },
      { label: "出单", value: "延迟 9 分" },
    ],
  },
  {
    caseName: "酒店房卡重刷案",
    headline: "门开两次",
    prompt: "住客睡着后，同一张房卡又在前台被重制。",
    note: "别只看谁进了门，也要看谁让门变得可以被打开。",
    signals: [
      { label: "房卡", value: "重制记录" },
      { label: "前台", value: "交班空档" },
      { label: "电梯", value: "楼层绕行" },
    ],
  },
  {
    caseName: "图书馆闭馆失窃案",
    headline: "书脊微歪",
    prompt: "闭馆铃后无人借阅，珍本架却空出一指宽。",
    note: "在安静地方查案，最小的位移也会发出很响的声音。",
    signals: [
      { label: "珍本", value: "空出一指" },
      { label: "闭馆", value: "铃后无借阅" },
      { label: "书车", value: "轮痕折返" },
    ],
  },
  {
    caseName: "洗衣房错拿赔偿案",
    headline: "纽扣不认",
    prompt: "赔偿单签完后，衣袋里出现了另一家酒店的纽扣。",
    note: "污渍、批号和一枚纽扣，足够把错拿变成调换。",
    signals: [
      { label: "纽扣", value: "外店批号" },
      { label: "洗标", value: "烫痕新鲜" },
      { label: "赔偿", value: "先签后验" },
    ],
  },
  {
    caseName: "港口集装箱错发案",
    headline: "箱号重影",
    prompt: "目的港没错，封箱照片却显示另一个箱门。",
    note: "一串箱号、一张照片和一次吊装，足够让路线改口。",
    signals: [
      { label: "箱号", value: "末位重影" },
      { label: "吊装", value: "顺序改动" },
      { label: "封照", value: "门纹不符" },
    ],
  },
  {
    caseName: "宠物医院账单案",
    headline: "针剂多了",
    prompt: "治疗记录只写两针，收费单却多出第三支。",
    note: "一笔账不一定大，但它能撬开所有人的时间表。",
    signals: [
      { label: "针剂", value: "多计一支" },
      { label: "病历", value: "页角折起" },
      { label: "收费", value: "手动改价" },
    ],
  },
  {
    caseName: "写字楼空调投诉案",
    headline: "温度逆行",
    prompt: "整层都喊冷，机房日志却显示制热被短暂打开。",
    note: "空调不会选边站队，但设置记录会留下偏心的痕迹。",
    signals: [
      { label: "温控", value: "制热 6 分" },
      { label: "机房", value: "门禁补刷" },
      { label: "投诉", value: "同层集中" },
    ],
  },
  {
    caseName: "美术班颜料污染案",
    headline: "蓝色太亮",
    prompt: "被毁的画只沾到一种蓝，调色盘却没人承认用过。",
    note: "别让情绪先定责，颜料干燥时间会比证词更诚实。",
    signals: [
      { label: "颜料", value: "干燥错时" },
      { label: "画架", value: "脚印半枚" },
      { label: "调色", value: "蓝色偏亮" },
    ],
  },
  {
    caseName: "地铁闸机逃票案",
    headline: "闸门慢半拍",
    prompt: "扣费成功，闸机日志却记录了一次异常跟随。",
    note: "从半秒延迟里，能看见一个人借走了另一个人的通行。",
    signals: [
      { label: "闸机", value: "慢半拍" },
      { label: "扣费", value: "成功一次" },
      { label: "客流", value: "贴身通过" },
    ],
  },
  {
    caseName: "便利店库存黑洞",
    headline: "货架会漏",
    prompt: "库存每天少一件，夜班监控却总在同一秒跳帧。",
    note: "重复出现的小误差，往往比一次大事故更接近真相。",
    signals: [
      { label: "库存", value: "日少一件" },
      { label: "夜班", value: "固定跳帧" },
      { label: "货架", value: "价签遮挡" },
    ],
  },
  {
    caseName: "停车场月卡转借案",
    headline: "车牌换脸",
    prompt: "同一张月卡，在两辆车之间只隔了四分钟。",
    note: "看似是系统识别错了，实际可能是有人教它错。",
    signals: [
      { label: "月卡", value: "四分钟双车" },
      { label: "车牌", value: "边框遮字" },
      { label: "出口", value: "人工放行" },
    ],
  },
  {
    caseName: "餐厅后厨过敏案",
    headline: "菜单改口",
    prompt: "客人确认无坚果，后厨小票却多出一行手写备注。",
    note: "厨房里的错常常很吵，真正关键的却是那一行小字。",
    signals: [
      { label: "小票", value: "手写备注" },
      { label: "菜单", value: "版本不一" },
      { label: "传菜", value: "路线交叉" },
    ],
  },
  {
    caseName: "实验室试剂挥发案",
    headline: "瓶口发白",
    prompt: "试剂少了二十毫升，柜门传感器却没有报警。",
    note: "从瓶口结晶、台面水痕和一段静默报警开始追。",
    signals: [
      { label: "试剂", value: "-20ml" },
      { label: "柜门", value: "报警静默" },
      { label: "台面", value: "水痕半圈" },
    ],
  },
  {
    caseName: "婚礼戒指遗失案",
    headline: "盒子太正",
    prompt: "戒指盒摆回原位，绒布压痕却偏了半厘米。",
    note: "越被摆得整齐的东西，越可能刚刚经历过慌乱。",
    signals: [
      { label: "戒盒", value: "压痕偏移" },
      { label: "宾客", value: "座次调换" },
      { label: "摄影", value: "缺一张图" },
    ],
  },
  {
    caseName: "快递站签收争议案",
    headline: "签名漂移",
    prompt: "收件人说没签字，签收板却留下过轻的笔迹。",
    note: "一笔太轻的签名，也许正好说明写字的人不该在那儿。",
    signals: [
      { label: "签名", value: "笔压过轻" },
      { label: "面单", value: "二次打印" },
      { label: "货架", value: "格口错放" },
    ],
  },
  {
    caseName: "银行叫号插队案",
    headline: "号码回头",
    prompt: "叫号顺序没变，窗口办理却跳过了两个等待号。",
    note: "大厅里的公平，可能藏在一张被作废的小票里。",
    signals: [
      { label: "叫号", value: "跳过两位" },
      { label: "小票", value: "作废重出" },
      { label: "窗口", value: "暂停 90 秒" },
    ],
  },
  {
    caseName: "打印室泄密案",
    headline: "纸边发热",
    prompt: "机密文件没外发，打印机缓存却多了一份预览。",
    note: "秘密不一定离开房间，它可能只是在缓存里短暂停留。",
    signals: [
      { label: "缓存", value: "多一份预览" },
      { label: "纸盒", value: "纸边发热" },
      { label: "账号", value: "代登录" },
    ],
  },
  {
    caseName: "健身房私教课案",
    headline: "课表变轻",
    prompt: "会员没来上课，签到记录却比本人更准时。",
    note: "健身房里最重的不是器械，是没人承认的代签。",
    signals: [
      { label: "签到", value: "本人缺席" },
      { label: "课表", value: "事后调整" },
      { label: "储物柜", value: "钥匙错位" },
    ],
  },
  {
    caseName: "小区门禁尾随案",
    headline: "门缝太长",
    prompt: "刷卡只有一次，门磁却开了整整十一秒。",
    note: "十一秒足够一个人通过，也足够一段证词变形。",
    signals: [
      { label: "门磁", value: "开启 11 秒" },
      { label: "刷卡", value: "仅一次" },
      { label: "梯控", value: "楼层异常" },
    ],
  },
  {
    caseName: "温泉馆手牌混用案",
    headline: "手牌串号",
    prompt: "消费记录进了 A 柜，毛巾却出现在 B 区。",
    note: "一只手牌换过手，整条动线都会留下不合身的痕迹。",
    signals: [
      { label: "手牌", value: "柜区串号" },
      { label: "毛巾", value: "B 区回收" },
      { label: "消费", value: "A 柜入账" },
    ],
  },
  {
    caseName: "无人售货机退款案",
    headline: "货道卡住",
    prompt: "退款已经到账，货道传感器却晚了三秒才复位。",
    note: "机器的犹豫很短，但足够让一个漏洞露出形状。",
    signals: [
      { label: "货道", value: "三秒复位" },
      { label: "退款", value: "提前到账" },
      { label: "传感", value: "抖动两次" },
    ],
  },
  {
    caseName: "羽毛球馆订场案",
    headline: "场灯没灭",
    prompt: "订场取消后，三号场的灯又亮了十八分钟。",
    note: "空场不代表没人来过，电表会记得那些脚步。",
    signals: [
      { label: "场灯", value: "多亮 18 分" },
      { label: "订场", value: "取消后入场" },
      { label: "电表", value: "峰值错后" },
    ],
  },
  {
    caseName: "会议室投屏泄露案",
    headline: "屏幕残影",
    prompt: "会议结束后，投屏记录留下一个陌生设备名。",
    note: "越短的连接越容易被忽略，也越像一次试探。",
    signals: [
      { label: "投屏", value: "陌生设备" },
      { label: "会议", value: "提前散场" },
      { label: "截图", value: "边角残影" },
    ],
  },
  {
    caseName: "水果批发称重案",
    headline: "秤台偏甜",
    prompt: "每箱只差二两，整车账目却多出一笔损耗。",
    note: "小到不值得争的数字，常常最适合被人反复利用。",
    signals: [
      { label: "称重", value: "每箱 +2 两" },
      { label: "损耗", value: "整车入账" },
      { label: "票据", value: "墨迹未干" },
    ],
  },
  {
    caseName: "驾校考试名额案",
    headline: "预约插针",
    prompt: "系统显示已满员，一个候考号却从缝里挤了进来。",
    note: "名额不会自己变多，只会有人让规则短暂失明。",
    signals: [
      { label: "预约", value: "满员插入" },
      { label: "候考", value: "号段异常" },
      { label: "短信", value: "延迟送达" },
    ],
  },
  {
    caseName: "民宿押金扣除案",
    headline: "照片太新",
    prompt: "房东发来的损坏照片，窗外天气却和入住日不一样。",
    note: "一张照片想证明现场，也会不小心证明时间。",
    signals: [
      { label: "照片", value: "天气不符" },
      { label: "押金", value: "先扣后验" },
      { label: "门锁", value: "退房后开启" },
    ],
  },
  {
    caseName: "办公室绿植枯萎案",
    headline: "叶片有盐",
    prompt: "没人承认浇错水，托盘边却结了一圈白霜。",
    note: "办公室的小事也能有真相，只是它长得比较慢。",
    signals: [
      { label: "叶片", value: "边缘发盐" },
      { label: "托盘", value: "白霜一圈" },
      { label: "水杯", value: "标签撕掉" },
    ],
  },
  {
    caseName: "影印合同缺页案",
    headline: "第九页薄",
    prompt: "双方合同都在，第九页纸纤维却不是同一批。",
    note: "纸张不会辩解，但它很擅长记住自己从哪里来。",
    signals: [
      { label: "合同", value: "第九页偏薄" },
      { label: "影印", value: "边距漂移" },
      { label: "装订", value: "孔位重打" },
    ],
  },
  {
    caseName: "车站失物招领案",
    headline: "伞柄换色",
    prompt: "失主描述都对，伞柄磨损却属于另一把伞。",
    note: "相似物品最会撒谎，尤其在人很多的地方。",
    signals: [
      { label: "伞柄", value: "磨损不符" },
      { label: "招领", value: "登记重写" },
      { label: "监控", value: "人群遮挡" },
    ],
  },
  {
    caseName: "培训机构退费案",
    headline: "课时缩水",
    prompt: "合同写满三十课时，系统却只承认二十七次签到。",
    note: "退费纠纷不怕吵，怕的是每份表都少同一个数字。",
    signals: [
      { label: "课时", value: "少三次" },
      { label: "合同", value: "版本混用" },
      { label: "签到", value: "批量导入" },
    ],
  },
  {
    caseName: "花店预订错送案",
    headline: "花卡反面",
    prompt: "花束送对了地址，卡片背面却压着另一张订单号。",
    note: "浪漫也会有物流痕迹，查清楚之前先别相信道歉。",
    signals: [
      { label: "花卡", value: "背印订单" },
      { label: "配送", value: "路线重叠" },
      { label: "花材", value: "批次不同" },
    ],
  },
  {
    caseName: "泳池水质超标案",
    headline: "试纸褪色",
    prompt: "检测表合格，废纸篓里的试纸却褪成了浅灰。",
    note: "合格章盖得越重，越要看旁边被丢掉的东西。",
    signals: [
      { label: "试纸", value: "浅灰褪色" },
      { label: "水质", value: "表格合格" },
      { label: "药剂", value: "瓶盖未拧紧" },
    ],
  },
  {
    caseName: "培训证书伪造案",
    headline: "钢印偏心",
    prompt: "证书编号是真的，钢印位置却偏离模板三毫米。",
    note: "真编号配假纸面，是最喜欢混进队伍的伪装。",
    signals: [
      { label: "钢印", value: "偏 3mm" },
      { label: "编号", value: "真实存在" },
      { label: "模板", value: "旧版边框" },
    ],
  },
  {
    caseName: "园区电动车起火案",
    headline: "插座发黑",
    prompt: "车主说只充了半小时，电表曲线却像整夜没睡。",
    note: "火灭以后，电流记录仍会把夜里发生的事讲完。",
    signals: [
      { label: "插座", value: "边缘发黑" },
      { label: "电表", value: "整夜负载" },
      { label: "车棚", value: "摄像偏转" },
    ],
  },
  {
    caseName: "KTV包厢损坏案",
    headline: "音量失真",
    prompt: "账单结清后，音响后台才弹出过载警告。",
    note: "派对结束不代表现场结束，后台日志还在醒着。",
    signals: [
      { label: "音响", value: "过载警告" },
      { label: "账单", value: "先结后报" },
      { label: "包厢", value: "杯印错位" },
    ],
  },
  {
    caseName: "牙科耗材登记案",
    headline: "批号掉队",
    prompt: "耗材数量没错，批号顺序却少了一段中间号。",
    note: "医疗记录里最可疑的，常是看起来刚好对上的数字。",
    signals: [
      { label: "耗材", value: "数量吻合" },
      { label: "批号", value: "中段缺失" },
      { label: "消毒", value: "时间倒挂" },
    ],
  },
  {
    caseName: "商场扶梯急停案",
    headline: "按钮干净",
    prompt: "急停按钮没有指纹，报警却只慢了四秒。",
    note: "没有指纹不是没有人，有时只是有人更会善后。",
    signals: [
      { label: "急停", value: "无指纹" },
      { label: "报警", value: "慢 4 秒" },
      { label: "扶梯", value: "梳齿划痕" },
    ],
  },
  {
    caseName: "咖啡店外卖错单案",
    headline: "杯套转向",
    prompt: "外卖员没拿错，杯套上的编号却朝向柜台内侧。",
    note: "错单从来不只发生在路上，也可能发生在交出去之前。",
    signals: [
      { label: "杯套", value: "编号反向" },
      { label: "出杯", value: "时间重叠" },
      { label: "外卖", value: "未改路线" },
    ],
  },
  {
    caseName: "社区团购少货案",
    headline: "箱角湿了",
    prompt: "团长说原箱未拆，箱角胶带却被水汽重新压平。",
    note: "一箱菜里的小缺口，能牵出一条很长的手。",
    signals: [
      { label: "箱角", value: "水汽压平" },
      { label: "团购", value: "少三份" },
      { label: "称重", value: "尾数相同" },
    ],
  },
  {
    caseName: "网约车绕路投诉案",
    headline: "轨迹打结",
    prompt: "导航推荐没变，行程轨迹却在高架下绕了一圈。",
    note: "绕路不一定为了钱，也可能为了避开一个摄像头。",
    signals: [
      { label: "轨迹", value: "高架绕圈" },
      { label: "导航", value: "推荐不变" },
      { label: "录音", value: "静音 23 秒" },
    ],
  },
  {
    caseName: "药企冷库报警案",
    headline: "温线断了",
    prompt: "报警短信没发出，温度曲线却在凌晨突然变直。",
    note: "曲线变直的地方，往往就是有人按住事实的地方。",
    signals: [
      { label: "温线", value: "凌晨变直" },
      { label: "短信", value: "未发出" },
      { label: "冷库", value: "门缝结霜" },
    ],
  },
  {
    caseName: "物业维修回访案",
    headline: "好评太快",
    prompt: "维修还没到场，系统已经收到了一条五星回访。",
    note: "提前出现的满意，通常不是满意，是某个人着急。",
    signals: [
      { label: "回访", value: "五星提前" },
      { label: "维修", value: "未到场" },
      { label: "工单", value: "照片复用" },
    ],
  },
  {
    caseName: "书店预售签名案",
    headline: "墨迹同温",
    prompt: "签名本分三批到店，墨迹干燥程度却完全一致。",
    note: "粉丝排队的热闹里，最冷静的是那一排墨迹。",
    signals: [
      { label: "签名", value: "干燥一致" },
      { label: "预售", value: "三批到店" },
      { label: "票根", value: "号段跳跃" },
    ],
  },
  {
    caseName: "会展样机损坏案",
    headline: "螺丝太亮",
    prompt: "样机外壳没裂，底部螺丝却像刚被拧过。",
    note: "展台上每个人都在看正面，真相可能藏在底部。",
    signals: [
      { label: "螺丝", value: "新拧痕" },
      { label: "样机", value: "外壳完好" },
      { label: "展台", value: "电源换位" },
    ],
  },
  {
    caseName: "水果店会员积分案",
    headline: "积分飞走",
    prompt: "收银员没改单，会员积分却在闭店后被清零。",
    note: "小店也有后台，后台也会留下不肯睡觉的时间戳。",
    signals: [
      { label: "积分", value: "闭店清零" },
      { label: "收银", value: "未改单" },
      { label: "后台", value: "远程登录" },
    ],
  },
] satisfies HomeHeroCopy[];

export function pickFallbackHomeHeroCopy(seed?: string) {
  if (!seed) return compactHomeHeroCopy(fallbackHomeHeroCopies[Math.floor(Math.random() * fallbackHomeHeroCopies.length)]);
  const index = Math.abs(hashString(seed)) % fallbackHomeHeroCopies.length;
  return compactHomeHeroCopy(fallbackHomeHeroCopies[index]);
}

export function pickFallbackHomeHeroCopyForHints(hints: string[], seed?: string) {
  const normalizedHints = hints.join(" ").toLowerCase();
  const scored = fallbackHomeHeroCopies
    .map((copy, index) => ({
      copy,
      index,
      score: scoreFallbackCopy(copy, normalizedHints),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  if (!scored.length) return pickFallbackHomeHeroCopy(seed ?? normalizedHints);

  const topScore = scored[0].score;
  const top = scored.filter((item) => item.score === topScore);
  const index = Math.abs(hashString(seed ?? normalizedHints)) % top.length;
  return compactHomeHeroCopy(top[index].copy);
}

function compactHomeHeroCopy(copy: HomeHeroCopy): HomeHeroCopy {
  return homeHeroCopySchema.parse({
    caseName: fitText(copy.caseName, homeHeroLimits.caseName),
    headline: fitText(makeHeadlineFromText(copy.headline), homeHeroLimits.headline),
    prompt: compactPromptText(copy.prompt, homeHeroLimits.prompt),
    note: compactNoteText(copy.note, homeHeroLimits.note),
    signals: copy.signals.slice(0, 3).map((signal) => ({
      label: fitText(compactLabel(signal.label), homeHeroLimits.signalLabel),
      value: extractSignalValue(signal.value, homeHeroLimits.signalValue),
    })),
  });
}

export function buildHomeHeroCopy(caseData: CaseData): HomeHeroCopy {
  const location = caseData.locations[0];
  const objects = location?.objects ?? [];
  const prompt = compactPromptText(
    caseData.openingEvent.brief || caseData.openingEvent.initialPrompt || "现场记录出现互相矛盾的空白。",
    homeHeroLimits.prompt,
  );
  const signals = buildSignals(caseData);
  const firstLead = compactEntityName(objects[0]?.name ?? location?.name ?? "现场记录", 8);

  return homeHeroCopySchema.parse({
    caseName: fitText(caseData.title, homeHeroLimits.caseName),
    headline: makeHeadline(caseData),
    prompt,
    note: compactNoteText(`先查${firstLead}，别让细节沉默。`, homeHeroLimits.note),
    signals,
  });
}

export function normalizeHomeHeroCopy(value: unknown, caseData: CaseData): HomeHeroCopy {
  const fallback = buildHomeHeroCopy(caseData);
  const source = value && typeof value === "object" ? (value as Partial<HomeHeroCopy>) : {};
  const rawSignals = Array.isArray(source.signals) ? source.signals : [];
  const signals = Array.from({ length: 3 }, (_, index) => {
    const signal = rawSignals[index];
    const fallbackSignal = fallback.signals[index];
    const rawLabel = typeof signal?.label === "string" ? signal.label : fallbackSignal.label;
    const rawValue = typeof signal?.value === "string" ? signal.value : fallbackSignal.value;
    const label = fitText(compactLabel(rawLabel), homeHeroLimits.signalLabel) || fallbackSignal.label;
    const value = extractSignalValue(rawValue, homeHeroLimits.signalValue) || fallbackSignal.value;

    return {
      label,
      value,
    };
  });
  const rawPrompt = typeof source.prompt === "string" ? source.prompt : fallback.prompt;
  const rawNote = typeof source.note === "string" ? source.note : fallback.note;

  return homeHeroCopySchema.parse({
    caseName:
      fitText(typeof source.caseName === "string" ? source.caseName : fallback.caseName, homeHeroLimits.caseName) ||
      fallback.caseName,
    headline:
      fitText(makeHeadlineFromText(typeof source.headline === "string" ? source.headline : fallback.headline), homeHeroLimits.headline) ||
      fallback.headline,
    prompt: compactPromptText(rawPrompt, homeHeroLimits.prompt),
    note: compactNoteText(rawNote.length > homeHeroLimits.note * 1.6 ? fallback.note : rawNote, homeHeroLimits.note),
    signals,
  });
}

function buildSignals(caseData: CaseData): HomeHeroCopy["signals"] {
  const location = caseData.locations[0];
  const objects = location?.objects ?? [];
  const candidates = [
    ...objects.slice(0, 3).map((object) => ({
      label: compactLabel(object.name),
      value: extractSignalValue(object.description, homeHeroLimits.signalValue),
    })),
    { label: "地点", value: fitText(location?.name ?? "初始现场", homeHeroLimits.signalValue) },
    { label: "人物", value: `${caseData.suspects.length} 人待问` },
    { label: "难度", value: fitText(caseData.difficulty || "待核验", homeHeroLimits.signalValue) },
  ].filter((item) => item.label && item.value);

  return Array.from({ length: 3 }, (_, index) => {
    const candidate = candidates[index] ?? fallbackHomeHeroCopies[index].signals[index];
    return {
      label: fitText(compactLabel(candidate.label), homeHeroLimits.signalLabel),
      value: extractSignalValue(candidate.value, homeHeroLimits.signalValue),
    };
  });
}

function makeHeadline(caseData: CaseData) {
  return makeHeadlineFromText(caseData.openingEvent.headline || caseData.title || caseData.theme);
}

function makeHeadlineFromText(source: string) {
  const compact = source
    .replace(/[《》“”"'，。？！：:；;、,.!?]/g, "")
    .replace(/案件|事件|事故|风波|争议|调查|异常|清晨|凌晨|午夜|深夜|夜里|雨夜|傍晚|临时|封存|发现|一间|一场/g, "")
    .replace(/的/g, "")
    .trim();

  if (compact.length >= 2 && compact.length <= homeHeroLimits.headline) return compact;
  if (compact.length > homeHeroLimits.headline) {
    return compact
      .replace(/^.{1,4}(码头|港区|港口|小区|社区|园区|校园|酒店|医院|仓库|车库|实验室|剧场|画廊|山庄|银行|书店|餐厅|民宿|冷库|泵房)/, "$1")
      .slice(0, homeHeroLimits.headline);
  }

  return "真相偏航";
}

function compactLabel(text: string) {
  return (
    text.replace(/记录|终端|控制台|附件|文件|登记|异常|设备|系统|线索|现场/g, "").slice(0, homeHeroLimits.signalLabel) ||
    text.slice(0, homeHeroLimits.signalLabel)
  );
}

function compactEntityName(text: string, maxLength: number) {
  return fitText(text.replace(/记录|终端|控制台|设备|系统/g, "").trim() || text, maxLength);
}

function extractSignalValue(text: string, maxLength: number) {
  const match = cleanHeroText(text).match(
    /[^，。；;,.!?？！]{0,10}(?:缺帧|黑屏|补录|错位|受潮|空槽|重复|划痕|翘边|折起|遮挡|偏移|跳帧|断电|延迟|回升|倒置|不符|缺失|重写|复用|静默|变直|未发|多出|少了|跳升|封条|空白)[^，。；;,.!?？！]{0,4}/,
  );
  return fitText(match?.[0] ?? bestShortFragment(text, maxLength, true), maxLength);
}

function compactPromptText(text: string, maxLength: number) {
  const compact = fitTextWithEnding(bestShortFragment(text, maxLength, true), maxLength);
  return compact.length >= 6 ? compact : "现场为何改口。";
}

function compactNoteText(text: string, maxLength: number) {
  const compact = fitTextWithEnding(bestShortFragment(text, maxLength, false), maxLength);
  return compact.length >= 8 ? compact : "先查记录，别急着定案。";
}

function bestShortFragment(text: string, maxLength: number, preferTension: boolean) {
  const source = cleanHeroText(text);
  const fragments = Array.from(
    new Set([
      source,
      ...source.split(/[。！？!?；;]/g),
      ...source.split(/[。！？!?；;，,、]/g),
    ]),
  )
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);

  if (!fragments.length) return source;

  return fragments
    .map((fragment, index) => ({
      fragment,
      score:
        (fragment.length <= maxLength ? 40 : Math.max(0, 18 - (fragment.length - maxLength))) +
        (preferTension && /谁|为何|为什么|哪|却|发现|消失|多出|少了|不见|没有|未|异常|封|空|黑|停|死者|失踪|泄露|调包|报警|门禁|监控|账|记录/.test(fragment)
          ? 14
          : 0) +
        (/[？?]$/.test(fragment) ? 8 : 0) -
        (/AI|可以|说明|直接追问|建议/.test(fragment) ? 10 : 0) -
        index,
    }))
    .sort((left, right) => right.score - left.score)[0].fragment;
}

function cleanHeroText(text: string) {
  return text.replace(/\s+/g, " ").replace(/\.{3,}|…+/g, "…").trim();
}

function fitText(text: string, maxLength: number) {
  const compact = cleanHeroText(text);
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function fitTextWithEnding(text: string, maxLength: number) {
  const compact = fitText(text, maxLength);
  if (!compact || /[。？?!！…]$/.test(compact)) return compact;
  if (compact.length >= maxLength) return `${compact.slice(0, maxLength - 1)}。`;
  return `${compact}。`;
}

function hashString(value: string) {
  let hash = 0;
  for (const char of value) {
    hash = (hash << 5) - hash + char.charCodeAt(0);
    hash |= 0;
  }
  return hash;
}

function scoreFallbackCopy(copy: HomeHeroCopy, normalizedHints: string) {
  const source = `${copy.caseName} ${copy.headline} ${copy.prompt} ${copy.note} ${copy.signals
    .map((signal) => `${signal.label} ${signal.value}`)
    .join(" ")}`.toLowerCase();
  let score = 0;

  for (const [pattern, keywords] of hintKeywordGroups) {
    if (!pattern.test(normalizedHints)) continue;
    for (const keyword of keywords) {
      if (source.includes(keyword)) score += 1;
    }
  }

  return score;
}

const hintKeywordGroups: Array<[RegExp, string[]]> = [
  [/cold|freezer|fridge|temp|冷|冻|温控|温度/, ["冷", "冻", "温", "药", "试剂", "样本"]],
  [/access|gate|guard|door|card|门禁|门岗|房卡|闸机/, ["门", "卡", "闸", "刷", "房卡"]],
  [/cctv|monitor|camera|video|监控|摄像/, ["监控", "摄像", "照片", "截图"]],
  [/ledger|book|bill|billing|账|册|单|票|合同|工单/, ["账", "单", "票", "合同", "工单", "名单"]],
  [/sample|lab|clinic|试剂|样本|药|医院|实验/, ["样本", "试剂", "药", "医院", "耗材"]],
  [/car|parking|车|地锁|车库/, ["车", "地锁", "停车", "轨迹"]],
  [/school|campus|class|考试|校园|课|培训/, ["校园", "课", "考试", "培训", "名单"]],
  [/hotel|room|民宿|酒店|房/, ["酒店", "房", "民宿", "房卡"]],
  [/print|paper|document|打印|纸|影印|文件/, ["打印", "纸", "合同", "缓存", "证书"]],
  [/warehouse|shipping|package|箱|快递|仓|货/, ["箱", "包裹", "仓", "货", "快递"]],
];
