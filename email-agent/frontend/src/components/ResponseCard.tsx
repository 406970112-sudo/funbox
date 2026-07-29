import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

interface ResponseCardProps {
  response: any
  error: string | null
}

export default function ResponseCard({ response, error }: ResponseCardProps) {
  if (!response && !error) return null

  return (
    <div className="mt-6">
      <Card>
        <CardHeader>
          <CardTitle>接口响应</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>错误</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : response ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant={response.success ? 'success' : 'destructive'}>
                  {response.success ? '成功' : '失败'}
                </Badge>
                <span>{response.message}</span>
              </div>
              
              {response.data && (
                <div className="space-y-2">
                  <h4 className="font-medium">接收的数据：</h4>
                  <div className="bg-muted p-4 rounded-md">
                    <pre className="text-sm">
                      {JSON.stringify(response.data.received, null, 2)}
                    </pre>
                  </div>
                  
                  <p className="text-sm text-muted-foreground">
                    时间戳: {format(new Date(response.data.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                  </p>
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}