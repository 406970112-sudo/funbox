import { useChat } from 'ai/react';
import ReactMarkdown from 'react-markdown';
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Loader2,
  MailPlus,
  Send,
  User,
  Users,
} from "lucide-react";
import remarkGfm from 'remark-gfm'
import { useEffect, useRef, useState } from 'react'
import { toast } from "sonner"
import { Toaster } from "@/components/ui/sonner"
import RecipientDirectoryPanel from '@/components/RecipientDirectoryPanel'
import { cn } from '@/lib/utils'

const assistantContentClassName = `
  min-w-0 text-sm leading-6 text-foreground
  [&_p]:my-0 [&_p+p]:mt-3
  [&_ul]:my-3 [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:pl-5
  [&_li]:my-1
  [&_table]:w-full [&_table]:border-collapse
  [&_th]:border [&_th]:border-border [&_th]:p-2 [&_th]:text-left
  [&_td]:border [&_td]:border-border [&_td]:p-2
`

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/agent',
    body: {
      user_id: '123'
    },
    streamProtocol: 'text',
    onResponse: (res) => {
      console.log(res)
    }
  })

  const [copyStatus, setCopyStatus] = useState<Record<string, string>>({});
  const [expandedRecipientGroups, setExpandedRecipientGroups] = useState<Set<string>>(() => new Set())
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const latestMessageContent = messages[messages.length - 1]?.content

  useEffect(() => {
    const messagesContainer = messagesContainerRef.current
    if (!messagesContainer) return

    messagesContainer.scrollTop = messagesContainer.scrollHeight
  }, [messages.length, latestMessageContent])

  const handleRecipientGroupToggle = (key: string) => {
    setExpandedRecipientGroups((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Group relations by function_index to create email templates
  const groupRelations = (relations: any[]) => {
    if (!relations) return {};
    return relations.reduce((acc, rel) => {
      const key = JSON.stringify(rel.function_index.slice().sort());
      if (!acc[key]) {
        acc[key] = {
          function_index: rel.function_index,
          recipients: [],
        };
      }
      acc[key].recipients.push(rel);
      return acc;
    }, {} as Record<string, { function_index: number[], recipients: any[] }>);
  };

  const handleCopyForTemplate = async (template: { function_index: number[], recipients: any[] }, functions: any[], update_time: string) => {
    const templateKey = JSON.stringify(template.function_index.slice().sort());
    const userFunctions = template.function_index.map(index => functions[index]);
    const htmlBody = `
      <p>您好：</p>
      <p>天翔CROS智慧信贷平台计划于 ${update_time} 进行版本发布，以下是与您相关的更新点:</p>
      <ol>
        ${userFunctions.map((func) => `<li><b>${func.name}:</b><br>${func.desc}</li>`).join('')}
      </ol>
      <br/>
      <p>应急回退方案：回退到上一个稳定版本。</p>
      <p>变更时间：${update_time}</p>
      <p>是否停服：是</p>
      <p>如有疑问，请随时联系！</p>
      <p>Best regards,</p>
      <p>XWFITECH AI 助手</p>
    `;

    try {
      // 同时提供纯文本和HTML格式
      const textBody = `您好：

天翔CROS智慧信贷平台计划于 ${update_time} 进行版本发布，以下是与您相关的更新点:

${userFunctions.map((func) => `${func.name}:
${func.desc}

`).join('')}
应急回退方案：回退到上一个稳定版本。
变更时间：${update_time}
是否停服：是

如有疑问，请随时联系！

Best regards,
XWFITECH AI 助手`;

      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([htmlBody], { type: 'text/html' }),
          'text/plain': new Blob([textBody], { type: 'text/plain' })
        })
      ]);

      setCopyStatus(prev => ({ ...prev, [templateKey]: '已复制' }));
      setTimeout(() => {
        setCopyStatus(prev => ({ ...prev, [templateKey]: '' }));
      }, 2000);
    } catch (err) {
      console.error('Failed to copy: ', err);
      setCopyStatus(prev => ({ ...prev, [templateKey]: '复制失败' }));
    }
  };

  // 在handleCopyForTemplate函数后添加新函数
  const handleCopySingleRecipient = async (email: Array<string>, name: string) => {
    try {
      await navigator.clipboard.writeText(email.join(','));
      console.log(1211)
      toast("复制成功", {
        description: `${name} 邮箱地址: ${email}`,
      });
    } catch (err) {
      toast("复制异常", {
      });
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/50 p-3 pr-[60px] md:p-5 md:pr-[132px]">
      <RecipientDirectoryPanel />
      <Toaster position="top-center"/>
      <Card className="grid h-[calc(100dvh-24px)] max-h-[920px] w-full max-w-[1320px] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg shadow-sm md:h-[calc(100dvh-40px)]">
        <CardHeader className="flex-row items-center gap-3 border-b px-4 py-3 md:px-6 md:py-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <MailPlus aria-hidden="true" className="size-4" />
          </div>
          <div className="min-w-0">
            <CardTitle className="truncate text-base tracking-normal md:text-lg">版本通知助手</CardTitle>
            <CardDescription className="mt-0.5 text-xs">XWFINTECH</CardDescription>
          </div>
        </CardHeader>

        <CardContent ref={messagesContainerRef} className="min-h-0 overflow-y-auto p-0 overscroll-contain">
          {messages.length === 0 ? (
            <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="flex size-11 items-center justify-center rounded-lg border bg-background text-primary shadow-sm">
                <MailPlus aria-hidden="true" className="size-5" />
              </div>
              <p className="text-sm font-medium text-foreground">开始创建版本通知</p>
            </div>
          ) : (
            <div className="flex min-h-full flex-col gap-6 px-4 py-5 md:px-6 md:py-6">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    'flex min-w-0 items-start gap-3 text-sm',
                    m.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                  )}
                >
                  <Avatar className="size-9">
                    <AvatarFallback
                      className={cn(
                        'text-xs',
                        m.role === 'user'
                          ? 'bg-secondary text-secondary-foreground'
                          : 'bg-primary text-primary-foreground'
                      )}
                    >
                      {m.role === 'user'
                        ? <User aria-hidden="true" className="size-4" />
                        : <Bot aria-hidden="true" className="size-4" />}
                    </AvatarFallback>
                  </Avatar>

                  {m.role === 'user' ? (
                    <div className="max-w-[88%] rounded-lg bg-primary px-4 py-3 text-primary-foreground md:max-w-[78%] [&_p]:m-0 [&_ol]:my-2 [&_ol]:pl-5 [&_ul]:my-2 [&_ul]:pl-5">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                    </div>
                  ) : (
                    (() => {
                      try {
                        const data = JSON.parse(m.content);
                        const parsedContent = JSON.parse(data.content) // Assuming data.content is the stringified JSON
                        if (parsedContent.type === 'email-render') {
                          const { function_list, relation, message, update_time } = parsedContent;
                          const emailTemplates = groupRelations(relation);
                          const templateKeys = Object.keys(emailTemplates);

                          return (
                            <div className="flex min-w-0 flex-1 flex-col gap-5">
                              <section aria-label="邮件发送预览" className="flex min-w-0 flex-col gap-3">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <MailPlus aria-hidden="true" className="size-4 shrink-0 text-primary" />
                                    <h3 className="truncate text-sm font-semibold text-foreground">邮件发送预览</h3>
                                  </div>
                                  <Badge variant="secondary">{templateKeys.length} 封</Badge>
                                </div>

                                <div className="overflow-hidden rounded-md border bg-background [&>div]:max-h-[420px] [&>div]:overflow-auto">
                                  <Table className="min-w-[760px] table-fixed">
                                    <TableCaption className="sr-only">版本通知邮件及其收件人列表</TableCaption>
                                    <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-muted">
                                      <TableRow>
                                        <TableHead className="w-14 px-3">序号</TableHead>
                                        <TableHead className="w-[42%] px-3">功能列表</TableHead>
                                        <TableHead className="w-[34%] px-3">收件人</TableHead>
                                        <TableHead className="w-[180px] px-3">操作</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {templateKeys.map((key, index) => {
                                        const template = emailTemplates[key];
                                        const status = copyStatus[key];
                                        const recipientCopyStatus = copyStatus[`email_${key}`]
                                        const isRecipientGroupExpanded = expandedRecipientGroups.has(key)
                                        const recipientDetailsId = `recipient-group-${index}`
                                        const recipientSummary = template.recipients
                                          .slice(0, 2)
                                          .map((recipient: { name: string }) => recipient.name)
                                          .join('、')

                                        return (
                                          <TableRow key={key}>
                                            <TableCell className="px-3 align-top text-muted-foreground">
                                              {index + 1}
                                            </TableCell>
                                            <TableCell className="px-3 align-top">
                                              <ul className="flex list-disc flex-col gap-2 pl-4 text-xs leading-5 text-foreground">
                                                {template.function_index.map((funcIndex: any) => (
                                                  <li key={funcIndex}>
                                                    <span className="font-semibold">{function_list[funcIndex]?.name}：</span>
                                                    {function_list[funcIndex]?.desc}
                                                  </li>
                                                ))}
                                              </ul>
                                            </TableCell>
                                            <TableCell className="px-3 align-top">
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                aria-expanded={isRecipientGroupExpanded}
                                                aria-controls={recipientDetailsId}
                                                className="h-auto w-full justify-between gap-2 px-0 py-0.5 text-left hover:bg-transparent"
                                                onClick={() => handleRecipientGroupToggle(key)}
                                              >
                                                <span className="min-w-0">
                                                  <Badge variant="outline">{template.recipients.length} 家机构</Badge>
                                                  <span className="mt-1 block truncate text-xs font-normal text-muted-foreground">
                                                    {recipientSummary}
                                                    {template.recipients.length > 2 ? ' 等' : ''}
                                                  </span>
                                                </span>
                                                {isRecipientGroupExpanded
                                                  ? <ChevronUp aria-hidden="true" data-icon="inline-end" />
                                                  : <ChevronDown aria-hidden="true" data-icon="inline-end" />}
                                              </Button>

                                              {isRecipientGroupExpanded ? (
                                                <div id={recipientDetailsId} className="mt-3 flex flex-wrap gap-1.5">
                                                  {template.recipients.map((recipient: { name: string; address: string[] }) => (
                                                    <Button
                                                      key={`${recipient.name}-${recipient.address.join()}`}
                                                      type="button"
                                                      size="sm"
                                                      variant="outline"
                                                      title={`复制${recipient.name}收件邮箱`}
                                                      className="h-7 max-w-full px-2"
                                                      onClick={() => handleCopySingleRecipient(recipient.address, recipient.name)}
                                                    >
                                                      <span className="truncate">{recipient.name}</span>
                                                    </Button>
                                                  ))}
                                                </div>
                                              ) : null}
                                            </TableCell>
                                            <TableCell className="px-3 align-top">
                                              <div className="flex items-center gap-2">
                                                <Button
                                                  type="button"
                                                  onClick={() => handleCopyForTemplate(template, function_list, update_time)}
                                                  size="sm"
                                                  disabled={!!status}
                                                >
                                                  {status === '已复制'
                                                    ? <Check aria-hidden="true" data-icon="inline-start" />
                                                    : <ClipboardCopy aria-hidden="true" data-icon="inline-start" />}
                                                  {status || '复制正文'}
                                                </Button>
                                                <Button
                                                  type="button"
                                                  onClick={() => {
                                                    const emails = template.recipients.map((r: { address: any; }) => r.address).join(',');
                                                    navigator.clipboard.writeText(emails);
                                                    setCopyStatus(prev => ({ ...prev, [`email_${key}`]: '邮件已复制' }));
                                                    setTimeout(() => {
                                                      setCopyStatus(prev => ({ ...prev, [`email_${key}`]: '' }));
                                                    }, 2000);
                                                  }}
                                                  size="icon"
                                                  variant="outline"
                                                  aria-label={recipientCopyStatus ? '收件人邮箱已复制' : '复制全部收件人邮箱'}
                                                  title={recipientCopyStatus ? '收件人邮箱已复制' : '复制全部收件人邮箱'}
                                                  disabled={!!recipientCopyStatus}
                                                >
                                                  {recipientCopyStatus
                                                    ? <Check aria-hidden="true" />
                                                    : <Users aria-hidden="true" />}
                                                </Button>
                                              </div>
                                            </TableCell>
                                          </TableRow>
                                        );
                                      })}
                                    </TableBody>
                                  </Table>
                                </div>
                              </section>

                              {message ? (
                                <div className={assistantContentClassName}>
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{message}</ReactMarkdown>
                                </div>
                              ) : null}
                            </div>
                          );
                        } else {
                          return (
                            <div className={cn('flex-1', assistantContentClassName)}>
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{parsedContent.content}</ReactMarkdown>
                            </div>
                          );
                        }
                      } catch (error) {
                        // Fallback for non-JSON or malformed content
                        return (
                          <div className={cn('flex-1', assistantContentClassName)}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{JSON.parse(m.content).content}</ReactMarkdown>
                          </div>
                        );
                      }
                    })()
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>

        <CardFooter className="border-t bg-background p-3 md:p-4">
          <form onSubmit={handleSubmit} className="w-full">
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                aria-label="版本变更内容"
                placeholder="输入版本变更内容"
                rows={2}
                onChange={handleInputChange}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e as any);
                  }
                }}
                className="max-h-36 min-h-16 flex-1 resize-y"
              />
              <Button
                type="submit"
                size="icon"
                aria-label={isLoading ? '正在生成版本通知' : '发送消息'}
                title={isLoading ? '正在生成' : '发送'}
                className="size-10 shrink-0"
                disabled={isLoading}
              >
                {isLoading
                  ? <Loader2 aria-hidden="true" className="animate-spin" />
                  : <Send aria-hidden="true" />}
              </Button>
            </div>
          </form>
        </CardFooter>
      </Card>
    </main>
  );
}
