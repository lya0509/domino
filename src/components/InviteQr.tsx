import React, { useMemo } from 'react';
import Svg, { Path } from 'react-native-svg';
import { qrModules, qrPath } from '../lib/inviteQr';

interface Props {
  value: string;
  size: number;
}

export const InviteQr: React.FC<Props> = ({ value, size }) => {
  const modules = useMemo(() => qrModules(value), [value]);
  const count = modules.length;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${count} ${count}`} accessibilityLabel="Código QR de invitación">
      <Path d={qrPath(modules)} fill="#000000" />
    </Svg>
  );
};
