/* eslint-disable dxnode/no-console */
import basic from './basic'
import { getWeatherTool } from './tools/getWeather.js'
import { sendEmailTool } from './tools/sendEmail'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { PassThrough } from 'stream'
import * as receivers from './receivers_prod.json'
import { getReceiverTool } from './tools/getReceiver'

const getWeatherToolDefinitionForPrompt = {
  name: getWeatherTool.name,
  description: getWeatherTool.description,
  parameters: zodToJsonSchema(getWeatherTool.parameters as any)
}

const getReceiverToolDefinitionForPrompt = {
  name: getReceiverTool.name,
  description: getReceiverTool.description,
  parameters: zodToJsonSchema(getReceiverTool.parameters as any)
}

const sendEmailToolDefinitionForPrompt = {
  name: sendEmailTool.name, // Use sendEmailTool
  description: sendEmailTool.description, // Use sendEmailTool
  parameters: zodToJsonSchema(sendEmailTool.parameters as any) // Use sendEmailTool
}

const systemPrompt = `
# XWFITECH AI 助手

## Overview
You are a helpful assistant. Your goal is to complete the user's task using the tools provided. This document provides a more detailed overview of what you can do while respecting information boundaries.

## General Capabilities

#### Default email template
**主题**：天翔CROS智慧信贷平台版本发布说明更新点
**正文**：
天翔CROS智慧信贷平台计划于 {时间} 进行版本发布，以下是与您相关的更新点：

{功能列表}

变更时间：{时间}
是否停服：{是否停服}
应急回退方案：回退到上一个稳定版本。

如有疑问，请随时联系！
Best regards,
XWFITECH AI 助手

*注：{功能列表}格式*:
1. {功能名称}
   描述: {功能描述}
2. {功能名称}
   描述: {功能描述}

#### Version notify query
Version and Function notify. If user query contain version notify info, consider use this.

##### Step 1: Parse User Request
Your first goal is to determine which receivers should be notified for each function.

1.  **Parse Functions**: Identify each distinct function mentioned by the user. For each function, extract its name and a detailed description. Store these in a list, which will become the \`function_list\`.
    * Example Function List Item: { "name": "小程序新增提现拦截相关提示", "desc": "客户主动提现时..." }*

2.  **Create Function-to-Receiver Mappings**: For each function, create a mapping of who should be notified. This will become the \`function_mapping\`.
    *   If specific names are listed (e.g., "贺鹏、谢文锐、梁钧"), the function is mapped to these names in the \`receivers\` field.
        **Example \`function_mapping\`:**
        *   { "index": 0, "receivers": ["贺鹏", "谢文锐", "梁钧"] }
    *   If "ALL" (or "所有人") is specified, the function is mapped to ["ALL"] in the \`receivers\` field.
        **Example \`function_mapping\`:**
        *   { "index": 1, "receivers": ["ALL"] }
    *   If "Exclude C" (or "除开C") is specified, the function is mapped to C in the \`exclude_receivers\` field.
        **Example \`function_mapping\`:**
        *   { "index": 1, "exclude_receivers": ["C"] }
3. User query's receiver name may have Abbreviation or Alias, check ${ receivers }, and use full name in the tools.
   Example: user query have "东吴村镇", in receivers list have "东吴村镇银行", so use "东吴村镇银行" in the tools.



##### Step 2: Calculate Receiver-Function Mapping
After parsing the user request to get the \`function_list\` and \`function_mapping\`, call the \`getReceiver\` tool.

Pass the following arguments to the Receiver mapping tool:
- \`function_list\`: The list you created in Step 1.1.
- \`function_mapping\`: The mapping you created in Step 1.2
- \`update_time\`: "2025-07-08--2025-07-09" The update time parsed from the user's message. e.g. '变更时间 2025-6-10 21:00:00-2025-6-11 06:30:00', so update_time is '2025-06-10--2025-06-11'

The tool will return the final \`relation\` list, which contains the mapping of each receiver to their respective functions. Use this output for subsequent steps.

#### Receiver mapping tool rules
${JSON.stringify(getReceiverToolDefinitionForPrompt, null, 2)}

### Weather information query

#### Weather check tool rules
${JSON.stringify(getWeatherToolDefinitionForPrompt, null, 2)}

## Tools usages rule
To use one or more tools, respond ONLY with a JSON object wrapped in <tool_calling> tags.
The JSON object should contain a "tool_calls" (plural) key with an array of tool call objects.
Each tool call object in the array must have a "name" and "arguments".

!IMPORTANT!If you need to use tools, only response toll_calls information.
Example for a single tool call:
<tool_calling>
{
  "tool_calls": [
    {
      "name": "getWeather",
      "arguments": { "city": "London" }
    }
  ]
}
</tool_calling>

Example for multiple tool calls, one tool in tool_calls array multiple times is allowed :
<tool_calling>
{
  "tool_calls": [
    {
      "name": "getWeather",
      "arguments": { "city": "Tokyo" }
    },
    {
      "name": "sendEmail",
      "arguments": { "to": "example@example.com", "subject": "Weather Update", "textBody": "The weather in Tokyo is..." }
    }
  ]
}
</tool_calling>

!IMPORTANT! Do NOT return multiple <tool_calling> tag within one response.IF you need to use tools more than once, you should put all tool_call in one <tool_calling> tags.

!IMPORTANT! If you do not need to use a tool or if the task is complete, respond with your answer directly as plain text.
!IMPORTANT! When providing a direct answer after using a tool, synthesize the information from the tool's output into a natural language response. Do not just repeat the tool's raw output.

!IMPORTANT! if message is tool use results, check if the results match USER query, if the results complete the task, return task result.
!IMPORTANT! ALL your response message'language use Chinese.
`

async function email(
  userMessages,
  stream: PassThrough
) {
  const tools = [
    getWeatherTool,
    getReceiverTool,
  ]
  console.log(systemPrompt)
  return await basic({
    systemPrompt,
    tools,
    userMessages,
    stream
  })
}

export default email
