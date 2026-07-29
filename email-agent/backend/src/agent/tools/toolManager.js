// src/ai-functions/toolManager.js
import { getWeatherTool } from './getWeather.js'
import { sendEmailTool } from './sendEmail.js' // Import the new tool

// A map of available tools
const availableTools = {
  [getWeatherTool.name]: getWeatherTool,
  [sendEmailTool.name]: sendEmailTool // Add the new tool here
}

// Function to get all tool definitions (name, description, parameters schema)
export function getToolDefinitions() {
  return Object.values(availableTools).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters // Assuming parameters is the Zod schema object
  }))
}

// Function to get a specific tool's execute method
export function getToolExecutor(toolName) {
  const tool = availableTools[toolName]
  if (tool && typeof tool.execute === 'function') {
    return tool.execute
  }
  return null // Or throw an error if the tool or executor is not found
}

// Optionally, a function to get a specific tool instance if needed elsewhere
export function getTool(toolName) {
  return availableTools[toolName] || null
}
