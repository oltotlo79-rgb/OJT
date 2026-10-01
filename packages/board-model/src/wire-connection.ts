import type { Vec3 } from './geometry.js';

/** ネジの横から圧着端子を経て出る接続。電線をネジの真上へ立てない。 */
export interface WireConnection {
  terminalId: string;
  screw: Vec3;
  contact: Vec3;
  direction: Vec3;
  /** 2本は別々の圧着端子・出線位置を持つ。 */
  slot: number;
}

export const WIRE_PORT_PITCH_MM = 2.8;
export const WIRE_LUG_REACH_MM = 3.4;
export const WIRE_SLEEVE_LENGTH_MM = 6;
export const WIRE_SLEEVE_RADIUS_MM = 1.2;
