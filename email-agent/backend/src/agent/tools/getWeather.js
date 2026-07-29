import { z } from 'zod'

export const getWeatherTool = {
  description: 'Get the current weather for a location',
  name: 'getWeather',
  parameters: z.object({
    city: z
      .string()
      .describe('The city to get the weather for, e.g. San Francisco')
  }),
  execute: async ({ city }) => {
    // In a real application, you would call a weather API here.
    // For this example, we'll return mock data.
    if (city.toLowerCase() === 'london') {
      return {
        city,
        temperature: 15,
        description: 'Cloudy',
        humidity: '70%'
      }
    }
    if (city.toLowerCase() === 'tokyo') {
      return {
        city,
        temperature: 28,
        description: 'Sunny',
        humidity: '60%'
      }
    }
    return {
      city,
      temperature: Math.floor(Math.random() * 30) + 5, // Random temp between 5 and 34
      description: ['Sunny', 'Cloudy', 'Rainy', 'Windy'][
        Math.floor(Math.random() * 4)
      ],
      humidity: `${Math.floor(Math.random() * 50) + 50}%` // Random humidity between 50% and 99%
    }
  }
}
