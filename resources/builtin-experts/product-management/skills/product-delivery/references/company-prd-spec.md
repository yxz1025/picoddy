# 产品PRD规范

++**产品统一使用钉钉在线文档书写PRD文档，文档格式要求如下**++

### 钉钉PRD文档标题格式：

需求名称（跟tapd需求名称保持一致）

### PRD格式：

#### 1、相关链接（必有）

让读文档的小伙伴能快速找到需求相关的链接，下方链接中如当前需求需求无相关的链接，可以不放；

TAPD链接：

蓝湖设计稿链接：

业务需求文档链接：

数据调研分析链接：

#### 2、文档说明（必有）

用于记录需求从设计完成到开发过程中所有变更记录；

第一行为必须有的一行，用于记录“产品文档完成时间”；

第二行开始为开发过程中，需求调整记录，需要在说明列说明该次调整的内容，以及时间和产品经理；

| **序号** | **说明** | **日期** | **产品经理** |
| --- | --- | --- | --- |
| 1 | 完成产品文档 | 2025.10.10 | 王欣 |
| 2 | 增加xxxxx逻辑 | 2025.10.21 | 王欣 |
|  |  |  |  |

#### 3、需求相关方

1.  需求方：提报需求业务方姓名
    
2.  PM：项目经理姓名
    
3.  PD：产品经理姓名
    
4.  交互：交互人员姓名
    
5.  UI：UI人员姓名
    
6.  前端：前端开发姓名
    
7.  服务端：服务端开发姓名
    
8.  测试：测试人员姓名
    

#### 4、需求正文

##### 一、需求背景（必有）

所有需求都需要有需求背景说明

##### 二、需求价值（必有）

所有需求都需要有需求价值说明

##### 三、需求清单（视需求情况可选）

1）**从0-1的需求**：需要有产品架构/拆解图或产品范围说明；

**参考1:**

![image.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/eLbnj1boeK80JlaN/img/88f05cd3-a926-4095-b4d4-1af0407e909d.png)

**参考2:**

![image.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/eLbnj1boeK80JlaN/img/3d31e4f1-c04a-414b-ad05-4ad050537f21.png)

2）**从1-N的需求**：该模块必有，用于说明本次需求新增/调整了哪个模块的哪个内容；

**参考1:**

| **产品域** | **模块** | **需求** |
| --- | --- | --- |
| 微商城 | 商品详情页 | 【新增】商品详情页平台服务保障入口 |
|  | 平台服务保障弹层 | 【新增】平台服务保障弹层 |
| 智慧中台 | 微商城业务中心 | 【新增】平台服务保障配置功能 |

##### 四、流程图/状态机（视需求情况可选）

需求中有**状态流转**或者**多系统数据交互**的场景和**纯接口对接（无界面）**的场景，该模块必须有；

\*该模块也可跟随需求描述，在相应的产品模块展示“流程图/状态机”

**参考1:**

![/tmp/iOALog/.new_Clipboard/Clipboard_Screenshot_1761010203.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/eLbnj1boeK80JlaN/img/e8682b3b-ecff-4abd-8a27-5c4326209d95.png)

**参考2:**

![/Users/renjiuxiao/Desktop/母版_1.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/eLbnj1boeK80JlaN/img/2f8f6392-8666-4b15-a1c1-43652337b09c.png)

##### 五、需求描述（视需求情况可选）

需求中有界面的场景，该模块必须有；采用**“图文结合”**形式进行需求说明；

\*需求中无界面的场景，该模块可以没有（纯逻辑或者接口对接类型需求）；

1、若某一个页面中存在多个描述点，采用“标记描述”方式进行描述（即图片上进行1/2/3标记；文字说明中对应界面上对应标记点1/2/3进行说明）

**参考:**

![/tmp/iOALog/.new_Clipboard/Clipboard_Screenshot_1761010432.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/eLbnj1boeK80JlaN/img/c97fb557-deae-41a7-b7a8-6b6ee05300ee.png)

2、可在需求描述中使用【新增】【改造】等改动类型标记，快速让开发/测试知道这条描述的开发方向；

**参考:**

![image.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/eLbnj1boeK80JlaN/img/9f67f9dc-39cd-4dfe-8a2e-e296940f99dc.png)

![image.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/eLbnj1boeK80JlaN/img/0d5a5fb3-8352-448f-9728-92a0d683cff5.png)

\*对于PRD正文内容，如果大家还有更好的方式和建议，可以随时沟通，持续沉淀至PRD规范内。

##### 六、数据埋点

需求中有需求开发上报行为埋点或需要开发抽取固定表头的数据表场景下，该模块必须有；

**行为埋点-参考:**

![/tmp/iOALog/.new_Clipboard/Clipboard_Screenshot_1761010464.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/eLbnj1boeK80JlaN/img/9f7fb796-0d20-4b49-98f3-ef8329c85481.png)

\*上述为微商城行为埋点参考表，不同端埋点方式不同，可根据不同埋点方式使用不同方式描述埋点需求。

**数据表抽取-参考:**

![image.png](https://alidocs.oss-cn-zhangjiakou.aliyuncs.com/res/eLbnj1boeK80JlaN/img/ba4053b1-a8a3-44e2-ac9c-f8420fb5a368.png)