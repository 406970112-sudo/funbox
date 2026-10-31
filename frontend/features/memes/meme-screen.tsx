import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { memo, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/features/auth/auth-provider";
import {
  addRecentMeme,
  createMemeRequestGate,
  newMemeId,
  parseMemeLocal,
  performMemeSave,
} from "@/lib/memes";
import type {
  MemeCategory,
  MemeImage,
  MemeLocal,
  MemePage,
  MemeRanking,
} from "@/lib/memes";
import {
  fetchMeme,
  fetchMemeCategories,
  fetchMemeFavorites,
  fetchMemeRankingDates,
  fetchMemeRankings,
  fetchMemes,
  MemeAPIError,
  memeMediaURL,
  recordMemeEvent,
  setMemeFavorite,
} from "@/lib/memes-api";
import { createMemeFavoriteSync } from "@/lib/meme-favorite-sync";
import { recordStoredRecentUsage } from "@/lib/recent-usage-storage";
import { recordStoredToolUsage } from "@/lib/tool-usage-storage";

const STORAGE = "funbox.memes.v1";
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "网络暂时不可用，请重试";
type Tab = "all" | "categories" | "ranking" | "favorites";
function Chip({
  label,
  active,
  onPress,
  disabled = false,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[s.chip, active && s.chipActive, disabled && s.disabled]}
    >
      <Text style={[s.chipText, active && s.white]}>{label}</Text>
    </Pressable>
  );
}
const Thumb = memo(function Thumb({
  image,
  onPress,
  width,
  rank,
}: {
  image: MemeImage;
  onPress: () => void;
  width: number;
  rank?: number;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`预览 ${image.title}`}
      onPress={onPress}
      style={[s.tile, { width }]}
    >
      <View
        style={{
          height: width - 12,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {failed ? (
          <Text style={s.muted}>图片暂不可用 · 点击重试</Text>
        ) : (
          <Image
            accessibilityLabel={image.title}
            source={{ uri: memeMediaURL(image.thumbnailUrl) }}
            resizeMode="contain"
            style={{ width: width - 12, height: width - 12 }}
            onError={() => setFailed(true)}
          />
        )}
        {image.animated ? <Text style={s.badge}>动图</Text> : null}
        {rank !== undefined ? (
          <Text style={s.rank}>{String(rank).padStart(2, "0")}</Text>
        ) : null}
      </View>
      <Text numberOfLines={1} style={s.tileTitle}>
        {image.title || image.label}
      </Text>
    </Pressable>
  );
});
export function MemeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    imageId?: string;
    category?: string;
  }>();
  const { accessToken: token, user } = useAuth();
  const accountId = token && user ? user.id : null;
  const { width } = useWindowDimensions();
  const columns = width < 600 ? 3 : width < 900 ? 4 : 6;
  const contentWidth = Math.min(width - 32, 1120);
  const tileWidth = (contentWidth - (columns - 1) * 10) / columns;
  const [tab, setTab] = useState<Tab>("all");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(params.category || "");
  const [type, setType] = useState("all");
  const [sort, setSort] = useState("default");
  const [group, setGroup] = useState("");
  const [categories, setCategories] = useState<MemeCategory[]>([]);
  const [categoryError, setCategoryError] = useState("");
  const [period, setPeriod] = useState("day");
  const [date, setDate] = useState("");
  const [dates, setDates] = useState<string[]>([]);
  const [dateCursor, setDateCursor] = useState("");
  const [showDates, setShowDates] = useState(false);
  const [recent, setRecent] = useState(false);
  const [pendingView, setPendingView] = useState(false);
  const [local, setLocal] = useState<MemeLocal | null>(null);
  const localRef = useRef<MemeLocal | null>(null);
  const [data, setData] = useState<MemePage>({
    items: [],
    total: 0,
    nextCursor: "",
  });
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [ranking, setRanking] = useState<MemeRanking | null>(null);
  const [cursors, setCursors] = useState([""]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [merging, setMerging] = useState(false);
  const [detail, setDetail] = useState<{
    image: MemeImage;
    related: MemeImage[];
  } | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRetry, setDetailRetry] = useState(0);
  const [originalFailed, setOriginalFailed] = useState(false);
  const [imageRetry, setImageRetry] = useState(0);
  const [busy, setBusy] = useState("");
  const [cloudFavorite, setCloudFavorite] = useState(false);
  const gate = useRef(createMemeRequestGate());
  const cursor = cursors[cursors.length - 1];
  const detailId = typeof params.imageId === "string" ? params.imageId : "";
  const detailIdRef = useRef(detailId);
  detailIdRef.current = detailId;
  const localReady = !!local;
  const accountQueue = accountId ? local?.favoriteQueues[accountId] || {} : {};
  const activeFavorites = accountId
    ? Object.keys(accountQueue).filter((id) => accountQueue[id])
    : local?.favorites || [];
  const pendingCount =
    Object.keys(accountQueue).length + (local?.favorites.length || 0);
  const syncRef = useRef<ReturnType<typeof createMemeFavoriteSync> | null>(
    null,
  );
  if (!syncRef.current)
    syncRef.current = createMemeFavoriteSync({
      read: () => localRef.current ?? parseMemeLocal(null),
      write: persist,
      send: (id, desired, credential) =>
        setMemeFavorite(id, desired, credential),
    });
  syncRef.current.setSession(accountId, token);
  const sessionIdentity = useRef(accountId);
  sessionIdentity.current = accountId;
  const localListKey =
    tab === "favorites" && (recent || pendingView || !token)
      ? (recent ? local?.recent : activeFavorites)?.join("\0")
      : "";

  function persist(next: MemeLocal) {
    localRef.current = next;
    setLocal(next);
    try {
      if (Platform.OS === "web" && typeof window !== "undefined")
        window.localStorage.setItem(STORAGE, JSON.stringify(next));
    } catch {
      setMessage("浏览器未允许本机存储，当前记录仅保留在本次页面中。");
    }
  }
  function updateLocal(update: (value: MemeLocal) => MemeLocal) {
    persist(update(localRef.current ?? parseMemeLocal(null)));
  }
  function reset() {
    gate.current.cancel();
    setCursors([""]);
  }
  function chooseTab(next: Tab) {
    reset();
    setTab(next);
    setError("");
  }
  function search(value: string) {
    setDraft(value);
    setQuery(value.trim());
    reset();
    if (value.trim())
      updateLocal((v) => ({
        ...v,
        searches: [
          value.trim(),
          ...v.searches.filter((item) => item !== value.trim()),
        ].slice(0, 12),
      }));
  }
  function openImage(image: MemeImage) {
    setMessage("");
    router.setParams({ imageId: image.id });
  }
  function closeDetail() {
    router.setParams({ imageId: undefined });
    setDetail(null);
    setDetailError("");
    setMessage("");
  }
  useEffect(() => {
    const sync = syncRef.current!;
    sync.setSession(accountId, token);
    return () => {
      sync.setSession(null, null);
      sessionIdentity.current = null;
    };
    // Render updates credentials; cleanup invalidates callbacks after screen unmount.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let next;
    try {
      next = parseMemeLocal(
        typeof window === "undefined"
          ? null
          : window.localStorage.getItem(STORAGE),
      );
    } catch {
      next = parseMemeLocal(null);
    }
    persist(next);
    void recordStoredRecentUsage({
      itemId: "memes",
      kind: "tool",
      usedAt: Date.now(),
    });
    void recordStoredToolUsage("memes", Date.now());
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query !== draft.trim()) {
        setQuery(draft.trim());
        gate.current.cancel();
        setCursors([""]);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [draft, query]);
  useEffect(() => {
    let active = true;
    fetchMemeCategories()
      .then((result) => {
        if (active) {
          setCategories(result.items || []);
          setCategoryError("");
        }
      })
      .catch((e) => {
        if (active) setCategoryError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  useEffect(() => {
    setBusy("");
    setMerging(false);
    setCloudFavorite(false);
  }, [accountId]);
  useEffect(() => {
    if (!accountId || !localRef.current) return;
    void syncFavorites();
    // Account identity drives merging; token rotation retains the same queue/session.
  }, [accountId, localReady]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!localRef.current) return;
    const localValue: MemeLocal = localRef.current;
    const requestGate = gate.current;
    const request = requestGate.start();
    setLoading(true);
    setError("");
    setUnavailable([]);
    async function load() {
      if (tab === "categories") {
        setData({ items: [], total: 0, nextCursor: "" });
        return;
      }
      if (tab === "ranking") {
        const result = await fetchMemeRankings(period, date);
        if (gate.current.current(request)) {
          setRanking(result);
          setData({
            items: result.items || [],
            total: result.items?.length || 0,
            nextCursor: "",
          });
        }
        return;
      }
      if (tab === "favorites" && (recent || pendingView || !token)) {
        const ids = recent
          ? localValue!.recent
          : accountId
            ? Object.keys(localValue.favoriteQueues[accountId] || {}).filter(
                (id) => localValue.favoriteQueues[accountId][id],
              )
            : localValue.favorites;
        const offset = Number(cursor) || 0;
        const slice = ids.slice(offset, offset + 36);
        const results = await Promise.allSettled(
          slice.map((id) => fetchMeme(id, token)),
        );
        const items: MemeImage[] = [],
          missing: string[] = [];
        results.forEach((result, index) => {
          if (result.status === "fulfilled") items.push(result.value.image);
          else if (
            result.reason instanceof MemeAPIError &&
            [404, 410].includes(result.reason.status)
          )
            missing.push(slice[index]);
          else throw result.reason;
        });
        if (gate.current.current(request)) {
          setData({
            items,
            total: ids.length,
            nextCursor: offset + 36 < ids.length ? String(offset + 36) : "",
          });
          setUnavailable(missing);
        }
        return;
      }
      const result =
        tab === "favorites" && token
          ? await fetchMemeFavorites(cursor, token)
          : await fetchMemes(
              {
                q: query,
                category,
                animated: type === "all" ? undefined : type === "animated",
                sort,
                cursor,
              },
              token,
            );
      if (gate.current.current(request))
        setData({ ...result, items: result.items || [] });
    }
    load()
      .catch((e) => {
        if (gate.current.current(request)) {
          if (e instanceof MemeAPIError && e.status === 409 && cursor) {
            setCursors([""]);
            setMessage("图库已更新，已返回第一页。");
          } else setError(errorText(e));
        }
      })
      .finally(() => {
        if (gate.current.current(request)) setLoading(false);
      });
    return () => requestGate.cancel();
  }, [
    tab,
    query,
    category,
    type,
    sort,
    cursor,
    period,
    date,
    recent,
    pendingView,
    token,
    accountId,
    refresh,
    localReady,
    localListKey,
  ]);

  useEffect(() => {
    if (!detailId || !local) return;
    let active = true;
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    setOriginalFailed(false);
    fetchMeme(detailId, token)
      .then((result) => {
        if (!active) return;
        setDetail(result);
        setCloudFavorite(!!result.image.favorite);
        updateLocal((v) => ({
          ...v,
          recent: addRecentMeme(v.recent, detailId),
        }));
        void recordMemeEvent(
          detailId,
          "view",
          newMemeId(),
          localRef.current!.anonymousId,
          token,
        ).catch(() => {});
      })
      .catch((e) => {
        if (active) setDetailError(errorText(e));
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
    // Local history updates must not re-open the detail or record another view.
  }, [detailId, token, detailRetry, !!local]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadDates(cursorValue = "") {
    try {
      const result = await fetchMemeRankingDates(cursorValue);
      setDates((v) =>
        cursorValue
          ? [...new Set([...v, ...result.dates])]
          : result.dates || [],
      );
      setDateCursor(result.nextCursor || "");
      setShowDates(true);
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  async function syncFavorites() {
    if (!accountId || !localRef.current) return;
    const owner = accountId;
    const epoch = syncRef.current!.sessionVersion();
    setMerging(true);
    try {
      const current = await syncRef.current!.sync();
      if (!current || sessionIdentity.current !== owner) return;
      const pending = Object.keys(
        localRef.current.favoriteQueues[owner] || {},
      ).length;
      setMessage(
        pending
          ? "部分藏图同步失败，已保留此账号待同步记录，请重试。"
          : "藏图已同步到账号",
      );
      setRefresh((v) => v + 1);
    } finally {
      if (
        sessionIdentity.current === owner &&
        syncRef.current!.sessionVersion() === epoch
      )
        setMerging(false);
    }
  }
  async function changeFavorite(id: string, desired: boolean) {
    const owner = accountId;
    if (!owner) {
      updateLocal((v) => ({
        ...v,
        favorites: desired
          ? [id, ...v.favorites.filter((item) => item !== id)]
          : v.favorites.filter((item) => item !== id),
      }));
      return;
    }
    const epoch = syncRef.current!.sessionVersion();
    setBusy("favorite");
    try {
      const success = await syncRef.current!.setFavorite(id, desired);
      if (
        sessionIdentity.current !== owner ||
        syncRef.current!.sessionVersion() !== epoch
      )
        return;
      if (success) {
        if (detailIdRef.current === id) setCloudFavorite(desired);
        setRefresh((v) => v + 1);
      } else setMessage("收藏操作暂未完成，已保留此账号待同步操作，可重试。");
    } finally {
      if (
        sessionIdentity.current === owner &&
        syncRef.current!.sessionVersion() === epoch
      )
        setBusy("");
    }
  }
  async function favorite() {
    if (!detail || busy) return;
    const id = detail.image.id;
    const queued = accountId
      ? localRef.current?.favoriteQueues[accountId]?.[id]
      : undefined;
    const wasFavorite =
      queued ?? (cloudFavorite || activeFavorites.includes(id));
    await changeFavorite(id, !wasFavorite);
  }
  async function action(kind: "download" | "page" | "image") {
    if (!detail || busy) return;
    setBusy(kind);
    setMessage("");
    try {
      if (typeof window === "undefined" || typeof document === "undefined")
        throw Error("请使用浏览器打开原图后保存");
      const page = new URL(window.location.href);
      page.searchParams.set("imageId", detail.image.id);
      if (kind === "page") {
        if (navigator.share) {
          await navigator.share({ title: detail.image.title, url: page.href });
          setMessage("已完成系统分享操作。");
        } else {
          await navigator.clipboard.writeText(page.href);
          setMessage("页面链接已复制。");
        }
        return;
      }
      const response = await fetch(memeMediaURL(detail.image.url));
      if (!response.ok) throw Error("原图下载失败，请重试");
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw Error("原图格式无效，请重试");
      const filename = `meme-${detail.image.id}.${detail.image.format.toLowerCase().replace("jpeg", "jpg")}`;
      if (kind === "image") {
        const files = [new File([blob], filename, { type: blob.type })];
        if (!navigator.share || !navigator.canShare?.({ files }))
          throw Error("此浏览器不支持分享图片，请下载原图或分享页面");
        await navigator.share({ files, title: detail.image.title });
        setMessage("已完成系统分享操作。");
      } else {
        await performMemeSave(
          async () => {
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            return "started";
          },
          () =>
            recordMemeEvent(
              detail.image.id,
              "save",
              newMemeId(),
              localRef.current!.anonymousId,
              token,
            ),
        );
        setMessage("已发起原图下载，请在浏览器下载列表确认。");
      }
    } catch (e) {
      setMessage(
        e instanceof Error && e.name === "AbortError"
          ? "已取消分享，图片仍在当前页面。"
          : errorText(e),
      );
    } finally {
      setBusy("");
    }
  }
  const filteredCategories = categories.filter(
    (item) =>
      (!group || item.group === group) &&
      (!query ||
        `${item.title} ${item.originalTitle || ""}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  const categoryTitle = categories.find((item) => item.id === category)?.title;
  const isFavorite =
    accountQueue[detailId] ??
    (cloudFavorite || activeFavorites.includes(detailId));
  return (
    <SafeAreaView style={s.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[s.content, { width: contentWidth }]}>
          <View style={s.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="返回工具中心"
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace("/tools")
              }
            >
              <Text style={s.back}>‹</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>表情包</Text>
              <Text style={s.muted}>分类搜图 · 把快乐收进日常</Text>
            </View>
            <Text style={s.logo}>FunBox</Text>
          </View>
          <TextInput
            accessibilityLabel={
              tab === "categories" ? "搜索分类名称" : "搜索表情包、分类"
            }
            value={draft}
            onChangeText={(value) => {
              setDraft(value);
              if (tab === "ranking" || tab === "favorites") chooseTab("all");
            }}
            onSubmitEditing={() => search(draft)}
            placeholder={
              tab === "categories" ? "搜索分类名称" : "搜索表情包、分类"
            }
            style={s.search}
            returnKeyType="search"
          />
          <Text style={s.source}>
            ChineseBQB ·{" "}
            {categories.length ? `${categories.length} 个分类` : "真实素材图库"}{" "}
            · 按现有分类和标签匹配
          </Text>
          <View style={s.nav}>
            {(
              [
                ["all", "全部"],
                ["categories", "分类"],
                ["ranking", "榜单"],
                ["favorites", "藏图"],
              ] as const
            ).map(([id, label]) => (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === id }}
                key={id}
                onPress={() => chooseTab(id)}
                style={[s.navItem, tab === id && s.chipActive]}
              >
                <Text style={[s.navText, tab === id && s.white]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          {message ? (
            <View accessibilityLiveRegion="polite" style={s.notice}>
              <Text style={s.noticeText}>{message}</Text>
            </View>
          ) : null}
          {tab === "all" ? (
            <>
              <View style={s.row}>
                {[
                  ["all", "全部"],
                  ["static", "静图"],
                  ["animated", "动图"],
                ].map(([id, label]) => (
                  <Chip
                    key={id}
                    label={label}
                    active={type === id}
                    onPress={() => {
                      setType(id);
                      reset();
                    }}
                  />
                ))}
                <View style={{ flex: 1 }} />
                <Chip
                  label={sort === "default" ? "默认排序" : "最新入库"}
                  onPress={() => {
                    setSort((v) => (v === "default" ? "newest" : "default"));
                    reset();
                  }}
                />
              </View>
              {category ? (
                <View style={s.row}>
                  <Text style={s.muted}>{categoryTitle || category}</Text>
                  <Chip
                    label="清除分类 ×"
                    onPress={() => {
                      setCategory("");
                      reset();
                    }}
                  />
                </View>
              ) : null}
              {local?.searches.length && !query ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={s.row}>
                    <Text style={s.muted}>最近搜索</Text>
                    {local.searches.map((value) => (
                      <Chip
                        key={value}
                        label={value}
                        onPress={() => search(value)}
                      />
                    ))}
                    <Chip
                      label="清除"
                      onPress={() =>
                        updateLocal((v) => ({ ...v, searches: [] }))
                      }
                    />
                  </View>
                </ScrollView>
              ) : null}
            </>
          ) : null}
          {tab === "categories" ? (
            <>
              {categoryError ? (
                <View style={s.notice}>
                  <Text>{categoryError}</Text>
                  <Chip
                    label="重试加载分类"
                    onPress={() => setRefresh((v) => v + 1)}
                  />
                </View>
              ) : null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={s.row}>
                  {[
                    "",
                    ...new Set(
                      categories.map((item) => item.group).filter(Boolean),
                    ),
                  ].map((value) => (
                    <Chip
                      key={value}
                      label={value || "全部分类"}
                      active={group === value}
                      onPress={() => setGroup(value)}
                    />
                  ))}
                </View>
              </ScrollView>
              <Text style={s.sectionTitle}>
                {filteredCategories.length} 个分类
              </Text>
              <View style={s.grid}>
                {filteredCategories.map((item) => (
                  <Pressable
                    accessibilityRole="button"
                    key={item.id}
                    onPress={() => {
                      setCategory(item.id);
                      setDraft("");
                      setQuery("");
                      chooseTab("all");
                    }}
                    style={[s.category, { width: tileWidth }]}
                  >
                    <Image
                      source={{ uri: memeMediaURL(item.coverUrl) }}
                      resizeMode="contain"
                      style={{ width: tileWidth - 18, height: tileWidth - 18 }}
                    />
                    <Text numberOfLines={1} style={s.tileTitle}>
                      {item.title}
                    </Text>
                    <Text style={s.muted}>{item.count} 张</Text>
                  </Pressable>
                ))}
              </View>
              {!filteredCategories.length && !categoryError ? (
                <Text style={s.empty}>
                  {categories.length
                    ? "没有找到分类，换个词试试。"
                    : "分类正在载入，暂未同步时请稍后重试。"}
                </Text>
              ) : null}
            </>
          ) : null}
          {tab === "ranking" ? (
            <>
              <View style={s.row}>
                {[
                  ["day", "今日"],
                  ["week", "本周"],
                  ["all", "总榜"],
                ].map(([id, label]) => (
                  <Chip
                    key={id}
                    label={label}
                    active={period === id}
                    onPress={() => {
                      setPeriod(id);
                      setDate("");
                      reset();
                    }}
                  />
                ))}
                {period === "day" ? (
                  <Chip label="历史日榜 ›" onPress={() => void loadDates()} />
                ) : null}
              </View>
              {showDates && period === "day" ? (
                <View style={s.dateBox}>
                  <Chip
                    label="今日实时"
                    active={!date}
                    onPress={() => {
                      setDate("");
                      reset();
                    }}
                  />
                  {dates.map((value) => (
                    <Chip
                      key={value}
                      label={value}
                      active={date === value}
                      onPress={() => {
                        setDate(value);
                        reset();
                      }}
                    />
                  ))}
                  {dateCursor ? (
                    <Chip
                      label="更多日期"
                      onPress={() => void loadDates(dateCursor)}
                    />
                  ) : null}
                  {!dates.length ? (
                    <Text style={s.muted}>暂无历史日榜</Text>
                  ) : null}
                </View>
              ) : null}
              <Text style={s.sectionTitle}>FunBox 站内热门</Text>
              {ranking && !loading ? (
                <View style={s.notice}>
                  <Text style={s.noticeText}>
                    {ranking.mode === "curated"
                      ? "精选推荐，热度积累中"
                      : `${ranking.date} · ${ranking.isFinal ? "已封榜" : "动态更新"}`}
                  </Text>
                  <Text style={s.muted}>
                    浏览 × 1 + 新增收藏 × 3 + 保存成功 × 5；每图至少 3
                    个有效主体，达标少于 10 张时展示精选。
                  </Text>
                  <Text style={s.muted}>
                    统计自 {ranking.dataSince || "本站上线"} · 更新于{" "}
                    {ranking.updatedAt
                      ? new Date(ranking.updatedAt).toLocaleString("zh-CN", {
                          timeZone: "Asia/Shanghai",
                        })
                      : "—"}
                    （北京时间）· 算法 {ranking.algorithmVersion}
                  </Text>
                  {ranking.notice ? (
                    <Text style={s.muted}>{ranking.notice}</Text>
                  ) : null}
                </View>
              ) : null}
            </>
          ) : null}
          {tab === "favorites" ? (
            <>
              <View style={s.row}>
                <Chip
                  label="我的藏图"
                  active={!recent && !pendingView}
                  onPress={() => {
                    setRecent(false);
                    setPendingView(false);
                    reset();
                  }}
                />
                <Chip
                  label="最近浏览"
                  active={recent}
                  onPress={() => {
                    setRecent(true);
                    setPendingView(false);
                    reset();
                  }}
                />
                {token && !!pendingCount ? (
                  <Chip
                    label="本机待同步"
                    active={pendingView}
                    onPress={() => {
                      setRecent(false);
                      setPendingView(true);
                      reset();
                    }}
                  />
                ) : null}
              </View>
              <View style={s.notice}>
                <Text style={s.noticeText}>
                  {token ? "账号藏图 · 跨设备同步" : "游客藏图仅保存在本机"}
                </Text>
                {!token ? (
                  <Chip
                    label="登录合并藏图"
                    onPress={() => router.push("/auth")}
                  />
                ) : null}
                {token && !!pendingCount ? (
                  <Chip
                    label={
                      merging
                        ? "同步中…"
                        : `重试同步 ${pendingCount} 个待同步操作`
                    }
                    disabled={merging}
                    onPress={() => void syncFavorites()}
                  />
                ) : null}
              </View>
            </>
          ) : null}
          {tab !== "categories" ? (
            <>
              {loading ? (
                <View style={s.empty}>
                  <ActivityIndicator color="#2d5bff" />
                  <Text style={s.muted}>正在加载…</Text>
                </View>
              ) : error ? (
                <View style={s.empty}>
                  <Text>{error}</Text>
                  <Chip
                    label="重新加载"
                    onPress={() => setRefresh((v) => v + 1)}
                  />
                </View>
              ) : (
                <>
                  <Text style={s.count}>
                    {query && tab === "all" ? `“${query}” · ` : ""}
                    {data.total} 张
                    {tab === "ranking" && ranking?.mode === "curated"
                      ? "精选素材"
                      : ""}
                  </Text>
                  <View style={s.grid}>
                    {data.items.map((image) =>
                      image.unavailable ? (
                        <View
                          key={image.id}
                          style={[s.category, { width: tileWidth }]}
                        >
                          <Text style={s.muted}>内容已不可用</Text>
                          <Chip
                            label="移除藏图"
                            disabled={!!busy}
                            onPress={() => void changeFavorite(image.id, false)}
                          />
                        </View>
                      ) : (
                        <Thumb
                          key={image.id}
                          image={image}
                          width={tileWidth}
                          rank={
                            tab === "ranking" && ranking?.mode === "ranking"
                              ? image.rank
                              : undefined
                          }
                          onPress={() => openImage(image)}
                        />
                      ),
                    )}
                    {unavailable.map((id) => (
                      <View style={[s.category, { width: tileWidth }]} key={id}>
                        <Text style={s.muted}>内容已不可用</Text>
                        <Chip
                          label="移除记录"
                          onPress={() => {
                            if (recent)
                              updateLocal((v) => ({
                                ...v,
                                recent: v.recent.filter((item) => item !== id),
                              }));
                            else void changeFavorite(id, false);
                          }}
                        />
                      </View>
                    ))}
                  </View>
                  {!data.items.length && !unavailable.length ? (
                    <View style={s.empty}>
                      <Text style={s.sectionTitle}>
                        {tab === "favorites"
                          ? "还没有收藏或浏览记录"
                          : "没有找到，换个词试试"}
                      </Text>
                      <Chip
                        label="浏览全部分类"
                        onPress={() => {
                          setDraft("");
                          setQuery("");
                          chooseTab("categories");
                        }}
                      />
                    </View>
                  ) : null}
                  {tab !== "ranking" ? (
                    <View
                      style={[
                        s.row,
                        { justifyContent: "center", marginTop: 22 },
                      ]}
                    >
                      <Chip
                        label="上一页"
                        disabled={cursors.length === 1}
                        onPress={() => setCursors((v) => v.slice(0, -1))}
                      />
                      <Text style={s.muted}>第 {cursors.length} 页</Text>
                      <Chip
                        label="下一页"
                        disabled={!data.nextCursor}
                        onPress={() =>
                          setCursors((v) => [...v, data.nextCursor])
                        }
                      />
                    </View>
                  ) : null}
                </>
              )}
            </>
          ) : null}
          <Text style={s.footer}>
            来源 ChineseBQB · 只展示可用素材 · 原图按需加载
          </Text>
        </View>
      </ScrollView>
      <Modal
        visible={!!detailId}
        transparent
        animationType="fade"
        onRequestClose={closeDetail}
      >
        <View style={s.overlay}>
          <View style={[s.dialog, { width: Math.min(width - 24, 640) }]}>
            <View style={s.detailHeader}>
              <Text style={s.sectionTitle}>表情详情</Text>
              <Chip label="关闭 ×" onPress={closeDetail} />
            </View>
            <ScrollView contentContainerStyle={{ padding: 18, gap: 14 }}>
              {detailLoading ? (
                <ActivityIndicator color="#2d5bff" />
              ) : detailError ? (
                <View style={s.empty}>
                  <Text>{detailError}</Text>
                  <Chip
                    label="重试"
                    onPress={() => setDetailRetry((v) => v + 1)}
                  />
                  {activeFavorites.includes(detailId) ? (
                    <Chip
                      label="移除本机藏图"
                      onPress={() => void changeFavorite(detailId, false)}
                    />
                  ) : null}
                </View>
              ) : detail ? (
                <>
                  <Image
                    key={`${detailId}-${imageRetry}-${originalFailed}`}
                    source={{
                      uri: memeMediaURL(
                        originalFailed
                          ? detail.image.thumbnailUrl
                          : detail.image.url,
                      ),
                    }}
                    resizeMode="contain"
                    style={{
                      width: "100%",
                      height: Math.min(width - 60, 400),
                      backgroundColor: "#fff",
                      borderRadius: 16,
                    }}
                    onError={() => setOriginalFailed(true)}
                  />
                  {originalFailed ? (
                    <View>
                      <Text style={s.muted}>原图加载失败，保留缩略图。</Text>
                      <Chip
                        label="重试原图"
                        onPress={() => {
                          setOriginalFailed(false);
                          setImageRetry((v) => v + 1);
                        }}
                      />
                    </View>
                  ) : null}
                  <Text style={s.title}>{detail.image.title}</Text>
                  <View style={s.row}>
                    {detail.image.categories.map((item) => (
                      <Chip
                        key={item.id}
                        label={item.title}
                        onPress={() => {
                          setCategory(item.id);
                          chooseTab("all");
                          closeDetail();
                        }}
                      />
                    ))}
                  </View>
                  <Text style={s.muted}>
                    {detail.image.format.toUpperCase()} · {detail.image.width} ×{" "}
                    {detail.image.height} ·{" "}
                    {(detail.image.bytes / 1024 / 1024).toFixed(2)} MB ·{" "}
                    {detail.image.animated ? "动图原图" : "静图原图"}
                  </Text>
                  <Text style={s.muted}>
                    来源 ChineseBQB
                    {detail.image.bytes > 5 * 1024 * 1024
                      ? " · 原图较大，下载可能需要一些时间"
                      : ""}
                  </Text>
                  {message ? (
                    <View accessibilityLiveRegion="polite" style={s.notice}>
                      <Text style={s.noticeText}>{message}</Text>
                    </View>
                  ) : null}
                  <View style={s.row}>
                    <Chip
                      label={isFavorite ? "★ 已收藏" : "☆ 收藏"}
                      active={isFavorite}
                      disabled={!!busy}
                      onPress={() => void favorite()}
                    />
                    <Chip
                      label="分享页面"
                      disabled={!!busy}
                      onPress={() => void action("page")}
                    />
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    disabled={!!busy}
                    onPress={() => void action("image")}
                    style={[s.primary, !!busy && s.disabled]}
                  >
                    <Text style={s.white}>
                      {busy === "image" ? "正在准备原图…" : "分享图片"}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={!!busy}
                    onPress={() => void action("download")}
                    style={[s.secondary, !!busy && s.disabled]}
                  >
                    <Text style={s.blue}>
                      {busy === "download" ? "正在下载原图…" : "下载原图"}
                    </Text>
                  </Pressable>
                  <Chip
                    label="打开原图预览"
                    onPress={() => {
                      void Linking.openURL(
                        memeMediaURL(detail.image.url),
                      ).catch((e) => setMessage(errorText(e)));
                    }}
                  />
                  <Text style={s.muted}>
                    动图效果由浏览器和接收客户端支持；下载完成请在浏览器中确认。
                  </Text>
                  {detail.related.length ? (
                    <>
                      <Text style={s.sectionTitle}>同类表情</Text>
                      <View style={s.grid}>
                        {detail.related.slice(0, 6).map((image) => (
                          <Thumb
                            key={image.id}
                            image={image}
                            width={(Math.min(width - 24, 640) - 56) / 3}
                            onPress={() => openImage(image)}
                          />
                        ))}
                      </View>
                    </>
                  ) : null}
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f5f7fa" },
  scroll: { alignItems: "center", paddingVertical: 16, paddingBottom: 40 },
  content: { gap: 16 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginVertical: 10,
  },
  back: { fontSize: 36, color: "#152341", paddingRight: 8 },
  title: { fontSize: 24, fontWeight: "800", color: "#152341" },
  logo: { fontSize: 18, fontWeight: "800", color: "#2d5bff" },
  muted: { fontSize: 12, lineHeight: 20, color: "#8290a7" },
  search: {
    backgroundColor: "#eaf0f6",
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
    fontSize: 15,
    color: "#152341",
  },
  source: { fontSize: 12, color: "#8290a7", lineHeight: 20 },
  nav: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#fff",
    padding: 6,
    borderRadius: 16,
  },
  navItem: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  navText: { fontSize: 15, fontWeight: "700", color: "#687991" },
  chip: {
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 10,
    backgroundColor: "#edf1f7",
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: { backgroundColor: "#2d5bff" },
  chipText: { fontSize: 13, color: "#526681", fontWeight: "600" },
  white: { color: "#fff", fontWeight: "700" },
  blue: { color: "#2d5bff", fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { backgroundColor: "#fff", borderRadius: 14, padding: 6 },
  tileTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#152341",
    lineHeight: 23,
  },
  badge: {
    position: "absolute",
    bottom: 2,
    right: 2,
    fontSize: 10,
    color: "#fff",
    backgroundColor: "#2d5bff",
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  rank: {
    position: "absolute",
    top: 4,
    left: 4,
    fontSize: 22,
    fontWeight: "800",
    color: "#ff8b3d",
    backgroundColor: "#fff",
    borderRadius: 6,
    paddingHorizontal: 4,
  },
  category: {
    backgroundColor: "#fff",
    padding: 9,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: "#152341" },
  notice: { backgroundColor: "#eaf0ff", padding: 14, borderRadius: 14, gap: 7 },
  noticeText: { fontSize: 13, color: "#4163a5", lineHeight: 21 },
  count: { fontSize: 13, color: "#8290a7", marginBottom: 10 },
  empty: {
    paddingVertical: 36,
    alignItems: "center",
    gap: 14,
    color: "#8290a7",
    textAlign: "center",
  },
  footer: {
    fontSize: 12,
    color: "#98a4b7",
    textAlign: "center",
    marginTop: 20,
  },
  dateBox: {
    padding: 12,
    backgroundColor: "#fff",
    borderRadius: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  disabled: { opacity: 0.5 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(17,30,56,0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 20,
  },
  dialog: {
    maxHeight: "95%",
    backgroundColor: "#f5f7fa",
    borderRadius: 22,
    overflow: "hidden",
  },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 18,
    backgroundColor: "#fff",
  },
  primary: {
    backgroundColor: "#2d5bff",
    padding: 15,
    borderRadius: 12,
    alignItems: "center",
  },
  secondary: {
    backgroundColor: "#dfe7ff",
    padding: 15,
    borderRadius: 12,
    alignItems: "center",
  },
});
