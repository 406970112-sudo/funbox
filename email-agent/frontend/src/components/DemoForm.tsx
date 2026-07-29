import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { testPostRequest } from '@/types/client'
import type { PostBody } from '@/types/api'
import ResponseCard from './ResponseCard'

export default function DemoForm() {
  const [formData, setFormData] = useState<PostBody>({ name: '' })
  const [response, setResponse] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    
    try {
      const result = await testPostRequest(formData)
      setResponse(result)
    } catch (err) {
      setError('请求失败，请检查控制台')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: name === 'age' ? (value ? Number(value) : undefined) : value
    }))
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>测试 Koa 接口</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">姓名 *</Label>
            <Input
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              placeholder="请输入姓名"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="age">年龄</Label>
            <Input
              id="age"
              name="age"
              type="number"
              value={formData.age || ''}
              onChange={handleChange}
              placeholder="请输入年龄"
            />
          </div>
          
          <Button 
            type="submit" 
            disabled={loading}
            className="w-full"
          >
            {loading ? "提交中..." : "测试 POST 请求"}
          </Button>
        </form>
        
        <ResponseCard response={response} error={error} />
      </CardContent>
    </Card>
  )
}