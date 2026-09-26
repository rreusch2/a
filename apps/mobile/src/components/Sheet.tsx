import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView, type BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { useEffect, useRef, type ReactNode } from 'react';
import { colors } from '../theme';

export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<BottomSheet>(null);
  useEffect(() => {
    if (open) ref.current?.snapToIndex(0);
    else ref.current?.close();
  }, [open]);

  return (
    <BottomSheet
      ref={ref}
      index={-1}
      snapPoints={['78%']}
      enablePanDownToClose
      onClose={onClose}
      backgroundStyle={{ backgroundColor: colors.surface }}
      handleIndicatorStyle={{ backgroundColor: colors.muted }}
      backdropComponent={(props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
      )}
    >
      <BottomSheetScrollView contentContainerStyle={{ padding: 20, paddingBottom: 56, gap: 12 }}>{children}</BottomSheetScrollView>
    </BottomSheet>
  );
}
