# Knowledge retrieval capability

- 区分索引写操作与只读查询：`rag_query`、`rag_status` 只读，`rag_index`、`rag_refresh` 会改变索引状态。
- 结论应能追溯到实际命中内容；没有命中不代表材料中不存在相关信息。
- 不跨越当前 owner、会话资源和文件授权边界，不把检索结果写入长期记忆。
