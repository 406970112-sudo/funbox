export const REQUIREMENT_PROMPT_PLACEHOLDER = '【在这里填写具体需求】';

export const REQUIREMENT_PROMPT_TEMPLATE = `需求如下：
${REQUIREMENT_PROMPT_PLACEHOLDER}
请先理解需求并检查现有代码，不要直接基于假设设计或修改。

请完成以下工作：

1. 说明当前实现方式、真实调用链路和最终用户可见结果。
2. 分析本次需求涉及的所有输入、状态、分支、接口、回调、异步流程、页面状态、消息队列、缓存和持久化影响。
3. 明确区分本次改造范围和非改造范围，确保不改变无关逻辑。
4. 检查各层之间的参数、返回值、错误信息和状态是否完整透传，重点关注包装层、适配层、默认值、fallback、去重和异步时序。
5. 给出改造前后差异、影响文件、风险点和兼容性分析。
6. 如果需要修改代码，请通过真实生产入口实现，不要只修改 mock、测试桩或局部函数。
7. 补充回归测试，至少覆盖正常、异常、边界、重复触发和不同业务分支，并验证最终用户可见结果，而不仅是中间函数返回值。
8. 执行相关测试和必要的静态检查，基于实际结果说明是否完成；不要在未验证前声称完成。
9. 保留现有无关改动，不要回退或覆盖与本需求无关的代码。

当前只是需要方案，md格式，请先不要修改代码，先输出：

- 当前实现
- 完整影响链路
- 改造点
- 前后差异
- 非改造范围
- 风险和测试方案

如果确认实施，再按方案修改、测试并汇报结果。`;

export function buildRequirementPrompt(requirement: string): string {
  if (requirement.length === 0) return REQUIREMENT_PROMPT_TEMPLATE;

  return REQUIREMENT_PROMPT_TEMPLATE.replace(REQUIREMENT_PROMPT_PLACEHOLDER, requirement);
}
