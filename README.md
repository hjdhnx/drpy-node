# drpyS(drpy-node)

nodejs作为服务端的drpy实现。全面升级异步写法  
积极开发中，每日一更，当前进度 `26%`

* [本地配置接口-动态本地](/config?pwd=)
* [本地配置接口-动态外网/局域网](/config/1?pwd=)
* [其他配置接口-订阅过滤](/docs/sub.md)
* [代码加解密工具](/admin/encoder)
* [V我50支付凭证生成器](/authcoder?len=10&number=1)
* [接口压测教程](/docs/httpTest.md)
* [央视点播解析工具](/proxy/央视大全[官]/index.html)
* [cookie管理插件](/apps/cookie-butler/index.html)
* [本站防止爬虫协议](/robots.txt)
* [本项目主页-免翻](https://git-proxy.playdreamer.cn/hjdhnx/drpy-node)

## 更新记录

### 20250104

更新至V1.1.0

1. 支持采王

[点此查看完整更新记录](docs/updateRecord.md)

## 基础框架

todo:

1. js里的源能否去除export开头，保持跟qjs一致
2. js里的源，像一级这种异步js，里面调用未定义的函数，能否不通过函数参数传入直接注入调用
3. 在源的各个函数调用的时候动态注入input、MY_URL等局部变量不影响全局。搞了半天没成功，有点难受，待解决

写源的函数不可以使用箭头函数，箭头函数无法拿到this作用域就没法获取input和MY_URL变量

精简去除的库:

1. axios
2. jsonpath
3. underscore
4. pino-pretty
5. deasync

## 参考资料

* [crypto-js-wasm使用教程](docs/crypto-js-wasm/readme-CN.md)
* [puppeteer使用教程](docs/pupInstall.md)
* [drpyS源属性说明](docs/ruleAttr.md)
* [drpy2写源简述](docs/ruleDesc.md)
* [讯飞星火开放平台](https://console.xfyun.cn/services/bm4)
* [讯飞星火智能体数据集](https://xinghuo.xfyun.cn/botcenter/private-dataset)

## 问题说明

1. windows上直接运行index.js可能会发现运行过程中的日志打印出中文乱码。建议通过yarn dev运行或者在package.json里点击dev脚本运行

## 安装说明

1.zy安装方案

* [多平台安装教程](https://zy.catni.cn/otherShare/drpyS-build.html)

2.自动化安装方案（直接薅道长羊毛）

* 终端执行

`bash -c "$(curl -fsSLk https://git-proxy.playdreamer.cn/hjdhnx/drpy-node/raw/refs/heads/main/autorun.sh)"`

* 添加定时方案

`echo "30 7 * * * cd /patch && bash -c \"\$(curl -fsSLk https://git-proxy.playdreamer.cn/hjdhnx/drpy-node/raw/refs/heads/main/autorun.sh)\" >> /patch/drpyslog.log 2>&1" | crontab -`

或者下载脚本到本地后

`chmod a+x /path/autorun.sh`

`echo "30 7 * * * bash /path/autorun.sh  >> /path/logfile.log 2>&1" | crontab -`

命令说明 /patch 为脚本存放路径（脚本放在与源码同级的自定义目录中）
