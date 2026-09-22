import type { DialectProfile } from '@ojt/plc-dialects';

/** IRの既存番号は維持する。通常の内部リレーと区別して接点入力の候補にする。 */
export const SPECIAL_CONTACT_LESSONS: Readonly<Record<number, { title: string; text: string }>> = {
  0: {
    title: '常時ON',
    text: 'RUN中に条件を常に成立させる接点です。出力コイルに書き込むデバイスではありません。',
  },
  1: {
    title: '初期パルス',
    text: '運転開始後の最初の1スキャンだけONになります。カウンタの初期化などに使い、運転中ずっとONにはなりません。',
  },
  2: {
    title: '1秒クロック',
    text: '0.5秒ON・0.5秒OFFを繰り返します。a接点とb接点で2つの出力を交互に点灯できます。',
  },
  3: {
    title: '常時OFF',
    text: 'a接点では条件が成立せず、b接点では成立します。接点の種類を替えたときの出力を予測してみましょう。',
  },
};

export function specialContactChoices(
  profile: DialectProfile,
): Array<{ index: number; name: string; title: string; contact: 'NO' | 'NC' }> {
  return Object.entries(profile.specialDevices).map(([key, name]) => {
    const index = Number(key);
    return {
      index,
      name,
      title: SPECIAL_CONTACT_LESSONS[index]?.title ?? name,
      contact: profile.specialInverted?.includes(index) === true ? 'NC' : 'NO',
    };
  });
}
