import { PageLoadingProgress, type SkeletonVariant } from './page-loading-skeleton';
import { ListPageSkeleton } from './page-loading-skeleton';
import { WorkbenchPageSkeleton } from './page-loading-skeleton';
import { PanelPageSkeleton } from './page-loading-skeleton';
import { ImmersivePageSkeleton } from './page-loading-skeleton';
import { PageStateScreen } from './page-state-screen';

type PageLoadingFrameProps = {
  onBack?: () => void;
  stateLabel?: string;
  title: string;
  variant?: SkeletonVariant;
};

export function PageLoadingFrame({
  onBack,
  stateLabel = '正在打开',
  title,
  variant = 'list',
}: PageLoadingFrameProps) {
  let skeleton = <ListPageSkeleton />;
  if (variant === 'workbench') skeleton = <WorkbenchPageSkeleton />;
  if (variant === 'panel') skeleton = <PanelPageSkeleton />;
  if (variant === 'immersive') skeleton = <ImmersivePageSkeleton />;

  return (
    <PageStateScreen
      onBack={onBack}
      progress={<PageLoadingProgress />}
      stateLabel={stateLabel}
      title={title}>
      {skeleton}
    </PageStateScreen>
  );
}
