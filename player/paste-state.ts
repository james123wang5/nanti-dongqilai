/** 放题流程的纯规则：次数按提交累计，已保存的旧题至少算有过一份回复。 */
export type PasteIssue = { kind: 'unreadable' | 'scene' | 'unsupported' | 'runtime' | 'result'; count?: number };
export const thirdAdvice = '试了 3 次还不行，可以先看讲解，或者换一个 AI 再试。';
export const unreadableRepair = '上一份回复还不能完整阅读。请按之前的格式重新输出完整回复，保留题目原文、每一小问的文字、答案和分步解答。题干、小问文字、每一步的说明和公式都请写成字符串，不要省略小问。';
export function attemptsOf(saved?: { attempts?: number }): number {
  return saved ? Number.isSafeInteger(saved.attempts) && saved.attempts! > 0 ? saved.attempts! : 1 : 0;
}
export function nextAttempt(saved?: { attempts?: number }, draftAttempts = 0): number {
  return saved ? attemptsOf(saved) + 1 : Math.max(0, Number.isSafeInteger(draftAttempts) ? draftAttempts : 0) + 1;
}
export const adviceFor = (attempts: number, issue?: PasteIssue) => issue && attempts >= 3 ? thirdAdvice : '';
export function noticeFor(issue: PasteIssue, attempts: number, copied?: boolean) {
  const message = issue.kind === 'scene' ? `AI 的回复有 ${issue.count ?? 1} 处写错了。`
    : issue.kind === 'unreadable' ? '这段回复里没有找到题目的小问。请确认复制的是 AI 的整段回复。'
    : issue.kind === 'result' ? '这份回复还有需要核对的地方。' : '这份回复暂时还不能动起来。';
  return { message, round: `第 ${attempts} 次`, warning: adviceFor(attempts, issue),
    next: `${copied === true ? '修改提示已复制' : '复制修改提示'} → 回到 AI 的对话粘贴发送 → 把它的新回复贴到下面，替换原来的内容。` };
}
export const commonTopics = ['力学', '带电粒子', '电磁感应', '电路', '热学', '光学'];
export const topicExamples: Record<string, string> = {
  力学: '受力、运动、碰撞和能量', 带电粒子: '粒子在电场、磁场里运动', 电磁感应: '线框、导轨、切割磁感线',
  电路: '电阻、电表、电容和电路连接', 热学: '气体状态变化、做功和传热', 光学: '折射、全反射和干涉',
  交变电流: '交流电、变压器和远距离输电', 静电场: '电场强度、电势和带电体受力', 万有引力: '卫星、双星和天体运动',
  振动与波: '振动、机械波和波形图', 原子物理: '原子、光电效应和半衰期', 实验: '读图、测量、误差和实验器材',
  运动方程: '题目给了微分关系或变力，要列方程积分',
};
export function topicRows(keys: string[]) { return [commonTopics.filter((k) => keys.includes(k)), keys.filter((k) => !commonTopics.includes(k))]; }
