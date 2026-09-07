/**
 * 中文时间/日期规则解析器 — 本地、确定性、离线可靠
 * 处理"明天下午3点""本周日""下周三""月底""下个月第一个周一"等口语表达
 */

export interface TimeParseResult {
  dueAt: number | null;
  /** 命中的规则描述（用于调试/展示） */
  matched: string | null;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// 中文数字 → 阿拉伯
const CN_NUM: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  十: 10, 十一: 11, 十二: 12, 十三: 13, 十四: 14, 十五: 15, 十六: 16,
  十七: 17, 十八: 18, 十九: 19, 二十: 20, 二十一: 21, 二十二: 22, 二十三: 23, 二十四: 24,
};

function toNum(s: string): number | null {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s in CN_NUM) return CN_NUM[s];
  // 混合如 "12点半" / "下周三" 不需要，这里只处理纯中文数字
  return null;
}

/** 解析文字里的"小时[:分]"或"x点y分"或"x点半" */
function parseClock(text: string): { hour: number; minute: number; raw: string } | null {
  const patterns: { re: RegExp; fn: (m: RegExpMatchArray) => { h: number; min: number } }[] = [
    {
      re: /(\d{1,2})[点時](\d{1,2})分/,
      fn: (m) => ({ h: +m[1], min: +m[2] }),
    },
    {
      re: /(\d{1,2})[点時]半/,
      fn: (m) => ({ h: +m[1], min: 30 }),
    },
    {
      re: /(\d{1,2})[:：](\d{1,2})/,
      fn: (m) => ({ h: +m[1], min: +m[2] }),
    },
    {
      re: /([一二两三四五六七八九十]+|[0-9]{1,2})[点時]/,
      fn: (m) => ({ h: toNum(m[1]) ?? 0, min: 0 }),
    },
  ];
  for (const p of patterns) {
    const m = text.match(p.re);
    if (m) {
      const { h, min } = p.fn(m);
      if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return { hour: h, minute: min, raw: m[0] };
    }
  }
  return null;
}

/** 把"下午""晚上"等时段偏移应用到小时 */
function applyPeriod(hour: number, text: string): number {
  if (/下午|傍晚|晚上|夜里|今晚|晚间/.test(text)) {
    if (hour <= 11) return hour + 12;      // 下午3点 → 15；今晚10点 → 22
    return hour;                            // 晚上20点 → 20
  }
  if (/中午|午间/.test(text)) {
    if (hour <= 10) return 12;
    return hour;
  }
  if (/清晨|凌晨|早上|早晨|上午/.test(text)) {
    return hour; // 保留
  }
  return hour;
}

/** 无具体时刻时，按时段词给默认小时（明天下午 → 明天 14:00） */
function periodDefaultHour(text: string): number | null {
  if (/清晨|凌晨/.test(text)) return 6;
  if (/早上|早晨|上午/.test(text)) return 9;
  if (/中午|午间/.test(text)) return 12;
  if (/下午/.test(text)) return 14;
  if (/傍晚/.test(text)) return 18;
  if (/晚上|今晚|夜里|晚间/.test(text)) return 20;
  return null;
}

const RELATIVE_DATE_RE = /下个月(?:第(?:一个|1个)|最后一个)(?:周|星期|礼拜)[一二三四五六日天]|下个月底|下月底|本月底|这个月底|月底|下下周[一二三四五六日天]?|下周[一二三四五六日天]?|下礼拜[一二三四五六日天]?|下星期[一二三四五六日天]?|(?:本周|这周|这个星期|本星期|本礼拜|这礼拜)[一二三四五六日天]|(?:周|星期|礼拜)[一二三四五六日天]|大后天|后天|明天|今晚|今天|周末/;

export interface DateExpression {
  text: string;
  start: number;
  end: number;
}

/** 返回文字中全部日期表达式，供编辑冲突检测；重叠表达式只保留最长命中。 */
export function extractDateExpressions(text: string): DateExpression[] {
  const found: DateExpression[] = [];
  const patterns = [
    /\d{1,2}月(?:\d{1,2}[日号])?/g,
    new RegExp(RELATIVE_DATE_RE.source, 'g'),
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      found.push({ text: match[0], start, end: start + match[0].length });
    }
  }
  return found
    .sort((a, b) => a.start - b.start || b.text.length - a.text.length)
    .filter((candidate, index, all) => !all.some((other, otherIndex) => otherIndex < index
      && candidate.start >= other.start && candidate.end <= other.end));
}

/** 找出标题中需要具体化的相对日期文本。 */
export function extractRelativeDateExpression(text: string): string | null {
  return text.match(RELATIVE_DATE_RE)?.[0] ?? null;
}

/** 下个月第一个/最后一个星期几。 */
function resolveNextMonthOrdinalWeekday(text: string, now: number): { date: Date; matched: string } | null {
  const match = text.match(/下个月(第(?:一个|1个)|最后一个)(?:周|星期|礼拜)([一二三四五六日天])/);
  if (!match) return null;

  const reference = new Date(now);
  const target = weekdayNum(match[2]); // 0=周一
  let date: Date;
  if (match[1] === '最后一个') {
    date = new Date(reference.getFullYear(), reference.getMonth() + 2, 0);
    const current = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - ((current - target + 7) % 7));
  } else {
    date = new Date(reference.getFullYear(), reference.getMonth() + 1, 1);
    const current = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() + ((target - current + 7) % 7));
  }
  return { date, matched: match[0] };
}

/** 当前月或下个月的最后一天。 */
function resolveMonthEnd(text: string, now: number): { date: Date; matched: string } | null {
  const match = text.match(/下个月底|下月底|本月底|这个月底|月底/);
  if (!match) return null;
  const reference = new Date(now);
  const monthOffset = /下个?月?底/.test(match[0]) && /下/.test(match[0]) ? 2 : 1;
  return {
    date: new Date(reference.getFullYear(), reference.getMonth() + monthOffset, 0),
    matched: match[0],
  };
}

/** 主解析函数 */
export function parseChineseTime(text: string, now = Date.now()): TimeParseResult {
  const t = text;

  // 1) 具体日期 + 时间：8月30号下午3点 / 10月15日 14:00
  const dateMatch = t.match(/(?:(\d{1,2})[月])(?:(\d{1,2})[日号])?/);
  const clock = parseClock(t);
  let base: Date | null = null;
  let matched: string | null = null;
  let dateSpecified = false;
  let rollBareWeekday = false;

  if (dateMatch && dateMatch[1]) {
    const month = +dateMatch[1];
    const day = dateMatch[2] ? +dateMatch[2] : null;
    if (month >= 1 && month <= 12 && (day === null || (day >= 1 && day <= 31))) {
      base = new Date(now);
      base.setMonth(month - 1);
      if (day) base.setDate(day);
      matched = dateMatch[0];
      dateSpecified = true;
    }
  }

  if (!base) {
    const ordinalWeekday = resolveNextMonthOrdinalWeekday(t, now);
    const monthEnd = ordinalWeekday ? null : resolveMonthEnd(t, now);
    if (ordinalWeekday) {
      base = ordinalWeekday.date;
      matched = ordinalWeekday.matched;
      dateSpecified = true;
    } else if (monthEnd) {
      base = monthEnd.date;
      matched = monthEnd.matched;
      dateSpecified = true;
    }
  }

  if (!base) {
    // 2) 相对日：明天 / 后天 / 本周日 / 下周三
    // 注意：长匹配必须放前面（"下周三"先于"下周"，"大后天"先于"后天"）
    const relDay = t.match(RELATIVE_DATE_RE);
    if (relDay) {
      const dayRef = relDay[0];
      matched = dayRef;
      dateSpecified = true;
      base = new Date(now);
      base.setHours(0, 0, 0, 0);
      if (/今晚|今天/.test(dayRef)) {
        // 今天
      } else if (/明天|明晚/.test(dayRef)) {
        base.setDate(base.getDate() + 1);
      } else if (/大后天/.test(dayRef)) {
        base.setDate(base.getDate() + 3);
      } else if (/后天/.test(dayRef)) {
        base.setDate(base.getDate() + 2);
      } else if (/下下周/.test(dayRef)) {
        // 下下周X：跳过一整周，落在下下周的星期X；未指定则 +14
        const wkday = dayRef.match(/[一二三四五六日天]/);
        const today = (base.getDay() + 6) % 7; // 0=周一
        if (wkday) {
          base.setDate(base.getDate() + 14 - today + weekdayNum(wkday[0]));
        } else {
          base.setDate(base.getDate() + 14);
        }
      } else if (/下周|下礼拜|下星期/.test(dayRef)) {
        // 下周X：落在下一周的星期X。
        // 旧算法 diff = target - today（<=0 时 +7）在周一说"下周三"会算成本周三（提前一周），
        // 正确语义是先跳到下周一再对齐星期：diff = 7 - today + target。
        const wkday = dayRef.match(/[一二三四五六日天]/);
        const today = (base.getDay() + 6) % 7; // 0=周一
        if (wkday) {
          base.setDate(base.getDate() + 7 - today + weekdayNum(wkday[0]));
        } else {
          base.setDate(base.getDate() + 7); // 下(某)天未指定 → 下周同天
        }
      } else if (/本周|这周|这个星期|本星期|本礼拜|这礼拜/.test(dayRef)) {
        // 明确指本周：即使目标日期已经过去，也忠实返回本周日期。
        const wkday = dayRef.match(/[一二三四五六日天]/)!;
        const today = (base.getDay() + 6) % 7;
        base.setDate(base.getDate() + weekdayNum(wkday[0]) - today);
      } else if (/周末/.test(dayRef)) {
        const today = (base.getDay() + 6) % 7;
        const diff = (5 - today + 7) % 7; // 到周六
        base.setDate(base.getDate() + (diff === 0 ? 7 : diff));
      } else if (/^(?:周|星期|礼拜)[一二三四五六日天]$/.test(dayRef)) {
        // 无“本/下”前缀：取下一次出现的星期几；若今天尚未到点则取今天。
        const wkday = dayRef.match(/[一二三四五六日天]/)!;
        const today = (base.getDay() + 6) % 7;
        base.setDate(base.getDate() + ((weekdayNum(wkday[0]) - today + 7) % 7));
        rollBareWeekday = true;
      }
    }
  }

  if (!base && clock) {
    // 3) 纯时间："下午3点" → 今天该时刻（已过则明天）
    base = new Date(now);
    matched = clock.raw;
  }

  if (!base) return { dueAt: null, matched: null };

  if (clock) {
    const h = applyPeriod(clock.hour, t);
    base.setHours(h, clock.minute, 0, 0);
  } else {
    // 无具体时刻：按时段词给默认（"明天下午"→14:00），否则 9:00
    base.setHours(periodDefaultHour(t) ?? 9, 0, 0, 0);
  }

  // 纯时间已过 → 明天；裸“周X”落在今天但时间已过 → 下周同一天。
  if (base.getTime() < now && rollBareWeekday) {
    base.setDate(base.getDate() + 7);
  } else if (base.getTime() < now && clock && !dateSpecified) {
    base.setDate(base.getDate() + 1);
  }

  return { dueAt: base.getTime(), matched };
}

function weekdayNum(c: string): number {
  const map: Record<string, number> = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 };
  return map[c] ?? 0;
}

/** 判断文本是否含明显时间信息 */
export function hasTimeHint(text: string): boolean {
  return RELATIVE_DATE_RE.test(text)
    || /[0-9]{1,2}[点時]|[0-9]{1,2}[:：][0-9]{2}|\d{1,2}月(\d{1,2}[日号])?/.test(text);
}
