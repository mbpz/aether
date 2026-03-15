# ISSUE-001

- TC：TC-002, TC-003, TC-013
- 严重度：P2
- 描述：`extractCodeFromTask` 函数仅支持从 fenced 代码块（` ```code``` `）或 backtick inline（`` `code` ``）中提取代码；当任务文本中含有裸代码片段（如 `"calculate: return 2+2"` 或 `"执行代码: return 42"`）时，无法正确提取，退化为使用默认示例代码 `console.log("Hello from Aether Agent"); 42`。
- 复现步骤：
  ```
  curl -s -X POST "http://127.0.0.1:19009/api/agent-loop/run" \
    -H "Content-Type: application/json" \
    --data-raw '{"task":"execute: return 2+2"}'
  ```
  实际 action.params.code = `console.log("Hello from Aether Agent"); 42`（默认值）
- 实际结果：`action.params.code = "console.log(\"Hello from Aether Agent\"); 42"`，输出 42（非 4）
- 预期结果：`action.params.code` 应提取任务中的 `return 2+2`，输出 4
- 受影响文件：`packages/gateway/src/agent-loop/planner.ts` → `extractCodeFromTask()` 函数
- 建议修复：增加正则匹配，提取冒号/换行后的裸代码片段；例如 `/(?:执行|exec|run|calculate|代码)[：:]\s*(.+)/i`
- 状态：fixed — 新增正则匹配 `/(?:执行|exec|run|calculate|计算|代码|eval)[：:]\s*(.+)/i`，提取裸代码片段；同时增加了对"动词 + 空格 + 代码"形式的支持
