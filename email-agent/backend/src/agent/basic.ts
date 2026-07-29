/* eslint-disable dxnode/no-console */
import { generateText, CoreMessage, Tool, AssistantContent } from 'ai'
import type { PassThrough } from 'stream'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import 'dotenv/config'

const deepSeek = createOpenAICompatible({
  baseURL: process.env.DEEPSEEK_API_URL,
  apiKey: process.env.DEEPSEEK_API_KEY,
  name: 'deepseek',
}).chatModel('deepseek-chat')

const languageModel = deepSeek

interface Basic {
  userMessages: Array<CoreMessage>,
  systemPrompt: string,
  tools: Array<Tool & {name: string}>
  stream: PassThrough
}

interface Results {
  tools: Array<{
    name: string,
    desc: string
  }>,
  content: AssistantContent
}

async function run({
  userMessages,
  systemPrompt,
  tools,
  stream
}:Basic) {
  console.log(
    '🚀 Starting AI Function Calling Example (Manual Tool Simulation)...'
  )

  const results:Results = {
    tools: [],
    content: ''
  }

  const userQuery = userMessages[userMessages.length - 1]

  const messages: Array<CoreMessage> = [
    { role: 'system', content: systemPrompt },
    ...userMessages
  ]

  const maxToolCalls = 5 // Safeguard against infinite loops
  let toolCallsMade = 0

  while (toolCallsMade < maxToolCalls) {
    console.log(`\n📞 Calling AI (Attempt ${toolCallsMade + 1})...`)
    // stream.write(SSEFormat(`Calling AI (Attempt ${toolCallsMade + 1})`))
    // Log messages being sent (optional, for debugging)
    // messages.forEach(msg => console.log(`  [${msg.role}]: ${typeof msg.content === 'string' ? msg.content.substring(0,100)+'...' : JSON.stringify(msg.content).substring(0,100)+'...'}`));
    if (messages[messages.length - 1].role === 'assistant') {
      messages.push({ role: 'user', content: userQuery.content as string })
    }
    const { text: aiResponseText } = await generateText({
      model: languageModel,
      messages: messages,
    })

    console.log('\n🤖 AI Raw Response:', aiResponseText)

    let parsedToolCalls // Changed to plural
    const toolCallRegex = /<tool_calling>([\s\S]*?)<\/tool_calling>/
    const match = aiResponseText.match(toolCallRegex)

    if (match && match[1]) {
      const jsonContent = match[1].trim()
      try {
        const potentialToolCallFormat = JSON.parse(jsonContent)
        // Expecting a "tool_calls" key with an array
        if (
          potentialToolCallFormat &&
          Array.isArray(potentialToolCallFormat.tool_calls)
        ) {
          parsedToolCalls = potentialToolCallFormat.tool_calls
        } else {
          console.log(
            '\n💬 AI Response had <tool_calling> tags, but content was not a valid tool_calls array structure:',
            jsonContent
          )
          messages.push({ role: 'assistant', content: aiResponseText })
          break
        }
      } catch (e) {
        console.error('\n❌ Error parsing JSON from <tool_calling> tags:', e)
        console.log('Content within tags:', jsonContent)
        messages.push({ role: 'assistant', content: aiResponseText })
        break
      }
    } else {
      // No <tool_calling> tags found, assume it's a direct answer.
      console.log(
        '\n💬 AI Direct Response (no <tool_calling> tags):',
        aiResponseText
      )
      messages.push({ role: 'assistant', content: aiResponseText })
      break // Exit loop as AI provided a direct answer
    }

    if (parsedToolCalls && parsedToolCalls.length > 0) {
      console.log(`\n🛠️ AI Requested ${parsedToolCalls.length} Tool Call(s):`)
      // stream.write(SSEFormat(`🛠️ AI Requested ${parsedToolCalls.length} Tool Call(s)`))
      // Add AI's raw response (which includes the <tool_calling> tags and JSON) to history ONCE
      // result
      messages.push({ role: 'assistant', content: aiResponseText })

      for (const toolCall of parsedToolCalls) {
        // Loop through each tool call
        console.log(`  - Name: ${toolCall.name}`)
        console.log(`  - Arguments: ${JSON.stringify(toolCall.arguments)}`)

        let toolToExecute
        const targetTool = tools.find(tool => tool.name === toolCall.name)
        if (targetTool) {
          toolToExecute = targetTool
          results.tools.push({
            name: targetTool.name,
            desc: targetTool.description
          })
        } else {
          console.warn(`\n⚠️ Unknown tool requested: ${toolCall.name}`)
          messages.push({
            role: 'assistant',
            content: JSON.stringify({
              error: `Tool '${toolCall.name}' not found.`
            })
          })
          continue // Skip to the next tool call in the array
        }

        try {
          const toolResult = await toolToExecute.execute(toolCall.arguments)
          console.log('\n✅ Tool Execution Result:')
          console.log(`  - Result: ${JSON.stringify(toolResult)}`)

          if (toolCall.name === 'getReceiver') {
            console.log(
              '\n✅ `getReceiver` tool executed. Returning result directly.'
            )
            results.content = JSON.stringify(toolResult)
            stream.write(JSON.stringify(results))
            return results.content
          }

          messages.push({
            role: 'assistant',
            content: JSON.stringify(toolResult)
          })
        } catch (error) {
          console.error('\n❌ Error executing tool:', error)
          messages.push({
            role: 'assistant', // CORRECTED ROLE
            content: JSON.stringify({
              error: error.message || 'Tool execution failed'
            })
          })
        }
      }
      toolCallsMade++
    } else {
      // No valid tool call detected in the JSON, assume it's a direct answer.
      // This case is largely covered by the catch block, but good for clarity.
      console.log(
        '\n💬 AI Direct Response (after JSON parse but no tool_call):',
        aiResponseText
      )
      messages.push({ role: 'assistant', content: aiResponseText })
      break
    }
  }

  if (toolCallsMade >= maxToolCalls) {
    console.warn('\n⚠️ Maximum tool call limit reached.')
  }

  const finalMessage = messages[messages.length - 1]
  if (finalMessage && finalMessage.role === 'assistant') {
    console.log('\n💬 AI Final Answer:', finalMessage.content)
    results.content = finalMessage.content
    stream.write(JSON.stringify(results))

    return finalMessage.content
  } else {
    console.log('\n🏁 No definitive final answer from AI after interactions.')
    return ' No definitive final answer from AI after interactions.'
  }
}

export default run
