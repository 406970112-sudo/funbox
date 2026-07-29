import { useEffect, useRef, useState } from 'react'
import {
  BookUser,
  ChevronDown,
  ChevronUp,
  Clock,
  Mail,
  Search,
  Users,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface RecipientDirectoryItem {
  bank: string
  name: string
  address: string[]
  cc_address: string[]
}

type LoadState = 'idle' | 'loading' | 'success' | 'error'

const BANK_SEARCH_ALIASES: Record<string, string[]> = {
  '甘肃农商': ['甘肃联社'],
  '沪农村镇': ['上农村镇'],
  '无锡锡商银行（理财）': ['无锡锡商银行', '无锡锡商'],
  '三峡银行(待上线)': ['三峡银行'],
  '联盟': ['联商'],
  '银联数据': ['银商'],
}

function normalizeSearchValue(value: string) {
  return value.trim().toLocaleLowerCase('zh-CN').replace(/\s+/g, '')
}

function getMatchingAlias(bank: string, normalizedQuery: string) {
  if (!normalizedQuery || normalizeSearchValue(bank).includes(normalizedQuery)) return undefined

  return BANK_SEARCH_ALIASES[bank]?.find((alias) => (
    normalizeSearchValue(alias).includes(normalizedQuery)
  ))
}

function HighlightedBankName({ name, query }: { name: string; query: string }) {
  const normalizedQuery = normalizeSearchValue(query)
  const normalizedName = normalizeSearchValue(name)
  const matchIndex = normalizedQuery ? normalizedName.indexOf(normalizedQuery) : -1

  if (matchIndex < 0) return <>{name}</>

  return (
    <>
      {name.slice(0, matchIndex)}
      <mark className="rounded-sm bg-primary/10 px-0.5 text-inherit">
        {name.slice(matchIndex, matchIndex + normalizedQuery.length)}
      </mark>
      {name.slice(matchIndex + normalizedQuery.length)}
    </>
  )
}

function formatUpdatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export default function RecipientDirectoryPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [recipients, setRecipients] = useState<RecipientDirectoryItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [updatedAt, setUpdatedAt] = useState('')
  const [expandedBanks, setExpandedBanks] = useState<Set<string>>(() => new Set())
  const [collapsedSearchBanks, setCollapsedSearchBanks] = useState<Set<string>>(() => new Set())
  const directoryRef = useRef<HTMLElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  const normalizedQuery = normalizeSearchValue(searchQuery)
  const filteredRecipients = normalizedQuery
    ? recipients.filter((recipient) => (
        normalizeSearchValue(recipient.bank).includes(normalizedQuery)
        || Boolean(getMatchingAlias(recipient.bank, normalizedQuery))
      ))
    : recipients
  const updatedAtLabel = updatedAt ? formatUpdatedAt(updatedAt) : ''

  useEffect(() => {
    if (!isOpen) return

    const controller = new AbortController()
    setLoadState('loading')

    fetch('/api/recipients', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load recipient directory')
        return response.json()
      })
      .then((payload: { data?: RecipientDirectoryItem[]; updatedAt?: string }) => {
        setRecipients(Array.isArray(payload.data) ? payload.data : [])
        setUpdatedAt(typeof payload.updatedAt === 'string' ? payload.updatedAt : '')
        setLoadState('success')
      })
      .catch((error: Error) => {
        if (error.name === 'AbortError') return
        setLoadState('error')
      })

    return () => controller.abort()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target || directoryRef.current?.contains(target)) return

      setIsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isOpen])

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value)
    setCollapsedSearchBanks(new Set())
    scrollAreaRef.current?.scrollTo({ top: 0 })
  }

  const handleRecipientToggle = (bank: string) => {
    if (normalizedQuery) {
      setCollapsedSearchBanks((current) => {
        const next = new Set(current)
        if (next.has(bank)) next.delete(bank)
        else next.add(bank)
        return next
      })
      return
    }

    setExpandedBanks((current) => {
      const next = new Set(current)
      if (next.has(bank)) next.delete(bank)
      else next.add(bank)
      return next
    })
  }

  return (
    <aside
      ref={directoryRef}
      aria-label="收件人目录"
      className={cn(
        'fixed inset-y-0 right-0 z-50 flex w-[min(calc(100vw-48px),420px)] bg-background shadow-[-12px_0_32px_rgba(15,23,42,0.14)] transition-transform duration-300 ease-out motion-reduce:transition-none',
        isOpen ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      <Button
        type="button"
        aria-label={isOpen ? '收起收件人目录' : '展开收件人目录'}
        aria-expanded={isOpen}
        title={isOpen ? '收起收件人目录' : '查看收件人目录'}
        className="absolute -left-12 top-1/2 h-11 w-12 -translate-y-1/2 rounded-l-md rounded-r-none border-r-0 px-0 shadow-lg md:-left-28 md:w-28 md:px-3"
        onClick={() => setIsOpen((open) => !open)}
      >
        <BookUser aria-hidden="true" data-icon="inline-start" />
        <span className="hidden md:inline">{isOpen ? '收起目录' : '收件人目录'}</span>
      </Button>

      <div aria-hidden={!isOpen} className="flex min-w-0 flex-1 flex-col border-l bg-background">
        <header className="shrink-0 border-b px-5 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-foreground">收件人目录</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {loadState === 'success'
                  ? normalizedQuery
                    ? `找到 ${filteredRecipients.length} 家银行`
                    : `共 ${recipients.length} 家银行`
                  : '银行邮件联系信息'}
              </p>
              {updatedAtLabel ? (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock aria-hidden="true" className="size-3.5" />
                  数据更新于 {updatedAtLabel}
                </p>
              ) : null}
            </div>
            <Badge variant="secondary">只读</Badge>
          </div>

          <div className="mt-4">
            <label htmlFor="recipient-bank-search" className="sr-only">搜索银行</label>
            <Input
              id="recipient-bank-search"
              type="search"
              value={searchQuery}
              placeholder="搜索银行名称"
              autoComplete="off"
              disabled={loadState !== 'success'}
              onChange={handleSearchChange}
            />
          </div>
        </header>

        <div ref={scrollAreaRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {loadState === 'loading' || loadState === 'idle' ? (
            <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
              正在加载收件人目录...
            </div>
          ) : null}

          {loadState === 'error' ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
              <Mail aria-hidden="true" className="text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">目录加载失败</p>
              <p className="text-xs leading-5 text-muted-foreground">请确认后端服务已启动后刷新页面</p>
            </div>
          ) : null}

          {loadState === 'success' && recipients.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
              <Users aria-hidden="true" className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground">暂无收件人数据</p>
            </div>
          ) : null}

          {loadState === 'success' && recipients.length > 0 && filteredRecipients.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
              <Search aria-hidden="true" className="text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">未找到相关银行</p>
              <p className="break-all text-xs leading-5 text-muted-foreground">没有名称包含“{searchQuery.trim()}”的银行</p>
            </div>
          ) : null}

          {loadState === 'success' && filteredRecipients.length > 0 ? (
            <ul className="divide-y">
              {filteredRecipients.map((recipient) => {
                const isExpanded = normalizedQuery
                  ? !collapsedSearchBanks.has(recipient.bank)
                  : expandedBanks.has(recipient.bank)
                const matchingAlias = getMatchingAlias(recipient.bank, normalizedQuery)
                const detailsId = `recipient-details-${encodeURIComponent(recipient.bank)}`

                return (
                  <li key={recipient.bank}>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-expanded={isExpanded}
                      aria-controls={detailsId}
                      className="h-auto w-full justify-between gap-3 rounded-none px-5 py-4 text-left"
                      onClick={() => handleRecipientToggle(recipient.bank)}
                    >
                      <span className="min-w-0 flex-1 whitespace-normal">
                        <span className="block break-words text-sm font-semibold text-foreground">
                          <HighlightedBankName name={recipient.bank} query={searchQuery} />
                        </span>
                        {matchingAlias ? (
                          <span className="mt-1 block text-xs font-normal text-muted-foreground">
                            匹配旧称：{matchingAlias}
                          </span>
                        ) : null}
                      </span>

                      <span className="flex shrink-0 items-center gap-1.5">
                        <Badge variant="outline">主送 {recipient.address.length}</Badge>
                        <Badge variant="secondary">抄送 {recipient.cc_address.length}</Badge>
                        {isExpanded
                          ? <ChevronUp aria-hidden="true" data-icon="inline-end" />
                          : <ChevronDown aria-hidden="true" data-icon="inline-end" />}
                      </span>
                    </Button>

                    {isExpanded ? (
                      <div id={detailsId} className="border-t bg-muted/30 px-5 py-4">
                        {recipient.name ? (
                          <p className="mb-4 break-words text-xs text-muted-foreground">联系人：{recipient.name}</p>
                        ) : null}

                        <dl className="flex flex-col gap-4">
                          <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-3">
                            <dt className="text-xs font-medium text-muted-foreground">收件人</dt>
                            <dd className="flex min-w-0 flex-col gap-1.5">
                              {recipient.address.length > 0 ? recipient.address.map((email) => (
                                <span key={email} className="break-all text-xs leading-5 text-foreground">{email}</span>
                              )) : (
                                <span className="text-xs text-muted-foreground">未配置</span>
                              )}
                            </dd>
                          </div>

                          <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-3">
                            <dt className="text-xs font-medium text-muted-foreground">抄送人</dt>
                            <dd className="flex min-w-0 flex-col gap-1.5">
                              {recipient.cc_address.length > 0 ? recipient.cc_address.map((email) => (
                                <span key={email} className="break-all text-xs leading-5 text-muted-foreground">{email}</span>
                              )) : (
                                <span className="text-xs text-muted-foreground">无</span>
                              )}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
