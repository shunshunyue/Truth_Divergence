import type { CaseData } from "@/game/schemas/game";

type TimelineEvent = CaseData["timeline"][number];

const periodDefaults: Array<{ pattern: RegExp; minute: number }> = [
  { pattern: /凌晨/, minute: 2 * 60 },
  { pattern: /清晨|一早|早晨|早上/, minute: 7 * 60 },
  { pattern: /上午/, minute: 10 * 60 },
  { pattern: /中午|午间/, minute: 12 * 60 },
  { pattern: /下午/, minute: 15 * 60 },
  { pattern: /傍晚|黄昏/, minute: 18 * 60 },
  { pattern: /晚上|夜里|夜间|当夜|昨夜/, minute: 21 * 60 },
  { pattern: /深夜/, minute: 23 * 60 },
];

function dayOffset(text: string) {
  if (/前天|前两天|两天前|案发前两天|事发前两天/.test(text)) return -2;
  if (/前一天|前一日|前晚|前夜|昨天|昨晚|昨日/.test(text)) return -1;
  if (/次日|翌日|第二天|第二日|转天/.test(text)) return 1;
  return 0;
}

function normalizeHour(hour: number, text: string) {
  if (/凌晨/.test(text) && hour === 12) return 0;
  if (/(下午|傍晚|晚上|夜里|夜间|深夜|当夜|昨夜|昨晚)/.test(text) && hour > 0 && hour < 12) {
    return hour + 12;
  }
  return hour;
}

function parseClockMinute(text: string) {
  const colonTime = text.match(/(\d{1,2})\s*[:：]\s*(\d{1,2})/);
  if (colonTime) {
    const hour = normalizeHour(Number(colonTime[1]), text);
    const minute = Number(colonTime[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return hour * 60 + minute;
  }

  const chineseTime = text.match(/(\d{1,2})\s*(?:点|时)(?:\s*(半|[0-5]?\d)\s*分?)?/);
  if (chineseTime) {
    const hour = normalizeHour(Number(chineseTime[1]), text);
    const minute = chineseTime[2] === "半" ? 30 : Number(chineseTime[2] ?? 0);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return hour * 60 + minute;
  }

  const period = periodDefaults.find((item) => item.pattern.test(text));
  return period?.minute;
}

function explicitDateScore(text: string) {
  const isoDate = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (isoDate) {
    return Number(isoDate[1]) * 372 + Number(isoDate[2]) * 31 + Number(isoDate[3]);
  }

  const monthDay = text.match(/(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})\s*(?:日|号)?/);
  if (monthDay) {
    return Number(monthDay[1]) * 31 + Number(monthDay[2]);
  }

  return undefined;
}

function timelineSortKey(event: TimelineEvent, index: number) {
  const text = `${event.time} ${event.description}`.replace(/\s+/g, " ");
  const dateScore = explicitDateScore(text);
  const minute = parseClockMinute(text);

  return {
    dateScore,
    day: dayOffset(text),
    minute: minute ?? Number.POSITIVE_INFINITY,
    hasTime: minute != null,
    index,
  };
}

export function sortTimelineEvents<T extends TimelineEvent>(events: T[]) {
  return events
    .map((event, index) => ({ event, key: timelineSortKey(event, index) }))
    .sort((left, right) => {
      if (left.key.dateScore != null || right.key.dateScore != null) {
        return (left.key.dateScore ?? 0) - (right.key.dateScore ?? 0) || left.key.minute - right.key.minute || left.key.index - right.key.index;
      }

      return (
        left.key.day - right.key.day ||
        Number(right.key.hasTime) - Number(left.key.hasTime) ||
        left.key.minute - right.key.minute ||
        left.key.index - right.key.index
      );
    })
    .map(({ event }) => event);
}
