const { adminPage, openPage, resource, confirm, toast, PLACEMENT_LABELS } = require("../utils/admin");
const { featureView, featurePayload } = require("../utils/feature");

const filters = [{ id: "", name: "全部" }, ...Object.entries(PLACEMENT_LABELS).map(([id, name]) => ({ id, name }))];

adminPage({
  required: "features.manage",
  data: { features: [], items: [], filters, location: "", search: "" },
  async load({ api, active }) {
    const { features } = await api("/features");
    if (active()) this.updateItems({ features: features.map(featureView) });
  },
  updateItems(patch) {
    const { features, search, location } = { ...this.data, ...patch };
    const term = search.trim().toLowerCase();
    this.setData({
      ...patch,
      items: features.filter((feature) => (!location || feature.placements.includes(location))
        && (!term || feature.name.toLowerCase().includes(term) || feature.id.toLowerCase().includes(term))),
    });
  },
  editSearch({ detail }) {
    this.updateItems({ search: detail.value });
  },
  chooseLocation(event) {
    this.updateItems({ location: event.currentTarget.dataset.location || "" });
  },
  openFeature(event) {
    openPage("feature", event.currentTarget.dataset.id);
  },
  toggleFeature(event) {
    const feature = this.data.features.find(({ id }) => id === event.currentTarget.dataset.id);
    if (!feature) return;
    return this.action(async ({ api, active }) => {
      const enabled = !feature.enabled;
      const title = enabled ? "开启功能入口" : "关闭功能入口";
      const content = enabled ? "将按已配置的位置和开放对象展示" + feature.name + "。"
        : "将在小程序各位置隐藏" + feature.name + "的入口，业务数据会保留。";
      if (!await confirm(title, content, "发布") || !active()) return;
      const response = await api(resource("/features", feature.id), { method: "PUT", data: featurePayload(feature, { enabled }) });
      if (!active()) return;
      const updated = featureView(response.feature);
      this.updateItems({ features: this.data.features.map((item) => item.id === updated.id ? updated : item) });
      toast("入口设置已发布");
    });
  },
});
