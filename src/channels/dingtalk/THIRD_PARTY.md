# 上游来源

本目录的机器人消息接收、msgId 去重和 sessionWebhook 文本/Markdown 回复方式，基于
[huang-x-h/pi-dingtalkbot](https://github.com/huang-x-h/pi-dingtalkbot) 适配。
核对的发布版本：pi-dingtalkbot 1.0.10，npm tarball SHA-1：b82c5c7f1106e05f6d0166e6b0ae60bd4d813c2d。
该版本 package.json 声明 MIT，作者 huang.xinghui；发布包未包含独立 LICENSE 文件。

本项目不加载上游 PI CLI 扩展，不引入旧 @mariozechner 运行时；改为适配本项目 channels 接口，
使用钉钉官方 dingtalk-stream 2.1.5。显式 ACK、连接生命周期、通道存储、IPC 和 Agent 桥接由本项目实现。

## MIT License

Copyright (c) huang.xinghui / pi-dingtalkbot contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
