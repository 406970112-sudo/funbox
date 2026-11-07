const NAMES = ['document', 'book', 'checklist', 'tag', 'lock', 'unlock', 'star', 'share', 'edit', 'search', 'filter', 'plus', 'close', 'chevron', 'chevron-down', 'more', 'pin', 'trash', 'key', 'check', 'user', 'refresh'];
const TONES = ['default', 'primary', 'white', 'coral'];
Component({
  properties: {
    name: { type: String, value: 'document' },
    tone: { type: String, value: 'default' },
    size: { type: Number, value: 40 },
  },
  data: { source: '/packages/notebook/assets/outline/document-default.png', displaySize: 40 },
  observers: {
    'name, tone, size': function(name, tone, size) {
      const safeName = NAMES.includes(name) ? name : 'document';
      const safeTone = TONES.includes(tone) ? tone : 'default';
      this.setData({
        source: `/packages/notebook/assets/outline/${safeName}-${safeTone}.png`,
        displaySize: Number.isFinite(size) && size > 0 ? size : 40,
      });
    },
  },
});
