/**
 * 本地通知调度 — 晨问 / 晚复盘 / 待办到点提醒
 * 全部本地实现，不依赖服务器。
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getProfile, listOpenTasks } from '../db';
import type { Entry } from '../types';
import { buildEveningCopy, buildMorningCopy } from './notification-copy';

const MORNING_HOUR = 8;
const EVENING_HOUR = 21;
const MORNING_ID = 'morning-question';
const EVENING_ID = 'evening-review';
/**
 * 晨晚提醒都依赖待办快照，逐日排未来 N 天；每次启动/任务变化后整体重挂。
 * 14 天共最多 28 条，给 iOS 的待发本地通知和单条待办提醒留出余量。
 */
const ROLLING_DAYS = 14;

function isGranted(status: Notifications.NotificationPermissionsStatus): boolean {
  if (status.status === 'granted') return true;
  if (Platform.OS !== 'ios' || !status.ios) return false;
  return [
    Notifications.IosAuthorizationStatus.AUTHORIZED,
    Notifications.IosAuthorizationStatus.PROVISIONAL,
    Notifications.IosAuthorizationStatus.EPHEMERAL,
  ].includes(status.ios.status);
}

export async function ensurePermissions(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (isGranted(current)) return true;
  return isGranted(await Notifications.requestPermissionsAsync());
}

/** 本地日 key（晨问逐日通知的 identifier 用） */
function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 取消所有以某前缀开头的已排通知（晨问逐日重挂前清场） */
async function cancelByPrefix(prefix: string): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    if (n.identifier.startsWith(prefix)) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }
}

/**
 * 注册任务驱动的晨问 + 夜间提醒（依据画像开关）。
 * 通知内容在调度时固定，因此按未来日期逐条排，并在任务变化后重挂。
 */
export async function scheduleDailyNotifications(): Promise<void> {
  // 逐日通知重挂前按前缀清场，同时兼容清理旧版 DAILY identifier。
  await cancelByPrefix(`${MORNING_ID}-`);
  await cancelByPrefix(`${EVENING_ID}-`);
  await Notifications.cancelScheduledNotificationAsync(MORNING_ID);
  await Notifications.cancelScheduledNotificationAsync(EVENING_ID);

  const [profile, tasks] = await Promise.all([getProfile(), listOpenTasks()]);
  const now = new Date();

  // 晨问：从明天起逐日计算“当天 → 7天窗 → 最近5条”。
  if (profile.notifyMorning) {
    for (let i = 1; i <= ROLLING_DAYS; i++) {
      const at = new Date(now);
      at.setDate(at.getDate() + i);
      at.setHours(MORNING_HOUR, 0, 0, 0);
      const copy = buildMorningCopy(tasks, at.getTime());
      if (!copy) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: `${MORNING_ID}-${dayKey(at)}`,
        content: {
          title: copy.title,
          body: copy.body,
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: at,
        },
      });
    }
  }

  // 夜间：若今天21:00尚未到，从今晚开始；否则从明晚开始。
  if (profile.notifyEvening) {
    const firstAt = new Date(now);
    firstAt.setHours(EVENING_HOUR, 0, 0, 0);
    if (firstAt.getTime() <= now.getTime()) firstAt.setDate(firstAt.getDate() + 1);

    for (let i = 0; i < ROLLING_DAYS; i++) {
      const at = new Date(firstAt);
      at.setDate(at.getDate() + i);
      const copy = buildEveningCopy(tasks, at.getTime());
      if (!copy) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: `${EVENING_ID}-${dayKey(at)}`,
        content: { title: copy.title, body: copy.body, sound: true },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
      });
    }
  }
}

let refreshChain: Promise<void> = Promise.resolve();

/**
 * 任务变化后的安全重排入口：无权限时不弹窗、不调度；并将并发刷新串行化，避免互相清场。
 */
export function refreshTaskDrivenNotifications(): Promise<void> {
  refreshChain = refreshChain
    .catch(() => {})
    .then(async () => {
      const permission = await Notifications.getPermissionsAsync();
      if (isGranted(permission)) await scheduleDailyNotifications();
    });
  return refreshChain;
}

/** 为某条目挂一条到点提醒（待办） */
export async function scheduleEntryReminder(
  entryId: string,
  at: Date,
  title: string,
  body: string,
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: `entry-${entryId}`,
    content: { title, body, sound: true },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
  });
}

/** 取消某条目的提醒 */
export async function cancelEntryReminder(entryId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(`entry-${entryId}`);
}

/** 按条目当前状态同步到点提醒（唯一入口，写路径都调这里）：
 *  task + 未完成 + 未来时间 → 挂提醒；其余（非 task / 已完成 / 已过期 / 无时间）→ 撤。 */
export async function syncEntryReminder(entry: Entry): Promise<void> {
  const active = entry.kind === 'task' && !entry.done
    && !!entry.dueAt && entry.dueAt > Date.now() + 60_000;
  if (active) {
    await scheduleEntryReminder(
      entry.id,
      new Date(entry.dueAt!),
      '待办提醒',
      entry.summary,
    );
  } else {
    await cancelEntryReminder(entry.id);
  }
  // 晨晚文案依赖任务快照；不阻塞当前写入流程，串行队列会合并顺序风险。
  void refreshTaskDrivenNotifications();
}

/** 设置通知点击后的行为（在 app 入口调用一次）。
 *  Android 上先建 channel：Android 13+ 的系统授权弹窗要求至少一个 channel 已存在。 */
export async function configureNotificationHandler(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: '默认',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}
