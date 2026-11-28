const { adminPage, resource, confirm, toast, PLACEMENT_LABELS, AUDIENCES } = require("../utils/admin");
const { featureView, featurePayload } = require("../utils/feature");

adminPage({
  required: "features.manage",
  data: { feature: null, draft: null, placements: [], audiences: AUDIENCES, audienceIndex: 0, changed: false },
  async load({ api, active }) {
    const { features } = await api("/features");
    if (!active()) return;
    const feature = features.find(({ id }) => id === this.pageOptions.id);
    if (!feature) throw { code: "feature_not_found" };
    this.applyFeature(feature);
  },
  applyFeature(feature) {
    const prepared = featureView(feature);
    this.applyDraft({ feature: prepared, draft: featurePayload(prepared) });
  },
  applyDraft(patch) {
    const { feature, draft } = { ...this.data, ...patch };
    this.setData({
      ...patch,
      placements: feature.placements.map((id) => ({
        id, name: PLACEMENT_LABELS[id] || id, checked: draft.visiblePlacements.includes(id),
      })),
      audienceIndex: Math.max(AUDIENCES.findIndex(({ id }) => id === draft.audience), 0),
      changed: JSON.stringify(featurePayload(feature)) !== JSON.stringify(draft),
    });
  },
  editDraft(patch) {
    if (this.data.ready && !this.data.busy) this.applyDraft({ draft: { ...this.data.draft, ...patch } });
  },
  changeEnabled({ detail }) {
    this.editDraft({ enabled: detail.value });
  },
  changePlacements({ detail }) {
    const selected = new Set(detail.value);
    this.editDraft({ visiblePlacements: this.data.feature.placements.filter((id) => selected.has(id)) });
  },
  changeAudience({ detail }) {
    const selected = AUDIENCES[Number(detail.value)];
    if (selected) this.editDraft({ audience: selected.id });
  },
  changeMaintenance({ detail }) {
    this.editDraft({ maintenance: detail.value });
  },
  publish() {
    if (!this.data.changed) return;
    const { feature, draft } = this.data;
    return this.action(async ({ api, active }) => {
      if (!await confirm("发布入口设置", "将更新「" + feature.name + "」在小程序中的入口设置。", "发布") || !active()) return;
      const response = await api(resource("/features", feature.id), { method: "PUT", data: draft });
      if (!active()) return;
      this.applyFeature(response.feature);
      toast("入口设置已发布");
    });
  },
});
