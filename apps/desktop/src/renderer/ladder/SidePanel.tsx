/** PLCの補助欄も共通の開閉・フォーカス動作を使う。 */
import { CollapsiblePanel } from '../panels/CollapsiblePanel.js';
import type { ComponentProps, JSX } from 'react';
export function SidePanel(
  props: Omit<ComponentProps<typeof CollapsiblePanel>, 'skin'>,
): JSX.Element {
  return <CollapsiblePanel {...props} skin="plc" />;
}
