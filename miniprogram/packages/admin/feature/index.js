const { adminPage, resource, confirm, toast, PLACEMENT_LABELS, AUDIENCES } = require("../utils/admin");
const { featureView, featurePayload } = require("../utils/feature");

const SIGNED_IN_AUDIENCES = AUDIENCES.filter(({ id }) => id !== "all");

adminPage({
  required: "features.manage",
  data: { feature: null, draft: null, placements: [], audiences: SIGNED_IN_AUDIENCES, audienceIndex: 0, changed: false },
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
      audienceIndex: Math.max(SIGNED_IN_AUDIENCES.findIndex(({ id }) => id === draft.audience), 0),
      changed: JSON.stringify(featurePayload(feature)) !== JSON.stringify(draft),
    });
  },
  editDraft(patch) {
    if (this.data.ready && !this.data.busy) this.applyDraft({ draft: { ...this.data.draft, ...patch } });
  },
  resetDraft() {
    if (this.data.feature && !this.data.busy) {
      this.applyDraft({ draft: featurePayload(this.data.feature), error: "" });
      toast("已还原修改");
    }
  },
  changeEnabled({ detail }) {
    this.editDraft({ enabled: detail.value });
  },
  togglePlacement(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || !this.data.draft) return;
    const selected = new Set(this.data.draft.visiblePlacements || []);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    this.editDraft({ visiblePlacements: this.data.feature.placements.filter((item) => selected.has(item)) });
  },
  changePlacements({ detail }) {
    const selected = new Set(detail.value);
    this.editDraft({ visiblePlacements: this.data.feature.placements.filter((id) => selected.has(id)) });
  },
  changeRequireLogin({ detail }) {
    const current = this.data.draft.audience;
    const audience = current === "all" ? "signed_in" : current;
    this.editDraft({ audience: detail.value ? audience : "all" });
  },
  changeAudience(event) {
    const datasetAudience = event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.audience;
    if (datasetAudience && SIGNED_IN_AUDIENCES.some(({ id }) => id === datasetAudience)) {
      this.editDraft({ audience: datasetAudience });
      return;
    }
    const selected = SIGNED_IN_AUDIENCES[Number(event.detail && event.detail.value)];
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
