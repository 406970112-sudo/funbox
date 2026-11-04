function asDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatNoteTime(value) {
  const date = asDate(value);
  if (!date) return "刚刚";
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) return `今天 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (date.getFullYear() === yesterday.getFullYear() && date.getMonth() === yesterday.getMonth() && date.getDate() === yesterday.getDate()) {
    return `昨天 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function formatFullDate(value) {
  const date = asDate(value);
  if (!date) return "";
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function noteExcerpt(note) {
  const body = String((note && note.body) || "").replace(/\s+/g, " ").trim();
  if (body) return body;
  const checklist = Array.isArray(note && note.checklist) ? note.checklist : [];
  const first = checklist.find(item => String(item && item.text || "").trim());
  if (first) return String(first.text).trim();
  return "空白笔记";
}

function noteTitle(note) {
  const title = String((note && note.title) || "").trim();
  if (title) return title;
  const excerpt = noteExcerpt(note);
  return excerpt === "空白笔记" ? "无标题笔记" : excerpt.slice(0, 24);
}

function bookTheme(color) {
  const value = String(color || "").toLowerCase();
  if (value === "#20a97a") return { fill: "#e8f7f1", ink: "#228364" };
  if (value === "#ff765e") return { fill: "#fff0ed", ink: "#c95e49" };
  if (value === "#2d5bff") return { fill: "#eaf2ff", ink: "#2d5bff" };
  return { fill: "#eef3fb", ink: "#5f7088" };
}

function decorateNote(note, index = 0) {
  const theme = bookTheme(note && note.bookColor);
  const tags = Array.isArray(note && note.tags) ? note.tags : [];
  return {
    ...note,
    displayTitle: noteTitle(note),
    excerpt: noteExcerpt(note),
    timeLabel: formatNoteTime(note && note.updatedAt),
    bookFill: theme.fill,
    bookInk: theme.ink,
    tagsText: tags.join(" · "),
    featureTag: tags[0] || "",
    index,
  };
}

function collectTags(notes) {
  const counts = {};
  (notes || []).forEach(note => {
    (note.tags || []).forEach(tag => {
      const value = String(tag || "").trim();
      if (!value) return;
      counts[value] = (counts[value] || 0) + 1;
    });
  });
  return Object.keys(counts)
    .map(tag => ({ tag, count: counts[tag] }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-CN"))
    .slice(0, 8);
}

module.exports = {
  formatNoteTime,
  formatFullDate,
  noteExcerpt,
  noteTitle,
  bookTheme,
  decorateNote,
  collectTags,
};
