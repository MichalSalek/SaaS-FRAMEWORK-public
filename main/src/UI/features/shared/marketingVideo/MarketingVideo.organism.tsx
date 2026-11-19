import { useTranslations } from 'next-intl';
import { PlayIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import type {
  CaptionLanguage,
  ResolvedMarketingVideo,
} from './marketingVideo.config';
import { useVideoPlayback } from './useVideoPlayback';
import styles from './MarketingVideo.module.css';

function formatTime(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function MarketingVideoOrganism({
  media,
}: {
  media: ResolvedMarketingVideo;
}) {
  const t = useTranslations('components.marketingVideo');
  const playback = useVideoPlayback(media);

  return (
    <div
      ref={playback.frameRef}
      className={styles.frame}
      data-marketing-video=''
      data-active={playback.activated || undefined}
      data-in-view={playback.inView}
      role='group'
      aria-label={t('label')}>
      <video
        ref={playback.videoRef}
        className={styles.video}
        preload='none'
        playsInline
        controls={playback.activated && !playback.hasError}
        tabIndex={playback.activated && !playback.hasError ? 0 : -1}
        aria-hidden={!playback.activated || playback.hasError}
        aria-label={t('label')}
        onPlay={playback.onPlay}
        onLoadedMetadata={playback.syncTime}
        onDurationChange={playback.syncTime}
        onSeeking={playback.syncTime}
        onSeeked={playback.syncTime}
        onPause={playback.syncTime}
        onTimeUpdate={playback.onTimeUpdate}
        onEnded={playback.onEnded}
        onError={playback.onError}>
        <track
          kind='captions'
          srcLang={media.captionLanguage}
          label={t(`captions.${media.captionLanguage}`)}
          src={
            playback.activated
              ? media.asset.captions[media.captionLanguage]
              : undefined
          }
          default
        />
        {playback.activated &&
          Object.entries(media.asset.captions)
            .filter(
              ([language, src]) =>
                language !== media.captionLanguage && src !== undefined
            )
            .map(([language, src]) => (
              <track
                key={language}
                kind='captions'
                srcLang={language}
                label={t(`captions.${language as CaptionLanguage}`)}
                src={src}
              />
            ))}
      </video>
      {playback.activated && !playback.hasError && (
        <div className={styles.progress}>
          <span aria-hidden='true'>{formatTime(playback.currentTime)}</span>
          <input
            className={styles.seek}
            type='range'
            min={0}
            max={playback.duration ?? 0}
            step='any'
            value={Math.min(playback.currentTime, playback.duration ?? 0)}
            disabled={playback.duration === null}
            aria-label={t('progress')}
            aria-valuetext={t('progressValue', {
              elapsed: formatTime(playback.currentTime),
              total:
                playback.duration === null
                  ? '--:--'
                  : formatTime(playback.duration),
            })}
            onChange={event => playback.seek(event.currentTarget.valueAsNumber)}
          />
          <span aria-hidden='true'>
            {playback.duration === null
              ? '--:--'
              : formatTime(playback.duration)}
          </span>
        </div>
      )}
      {!playback.activated && (
        <button
          type='button'
          className={styles.cover}
          onClick={playback.requestPlay}
          aria-label={t('playLabel')}>
          <span className={styles.playMark} aria-hidden='true'>
            <PlayIcon weight='fill' size={32} />
          </span>
          <span className={styles.title}>{t('play')}</span>
          <span className={styles.duration}>
            {t('duration', { seconds: media.asset.durationSeconds })}
          </span>
        </button>
      )}
      {playback.hasError && (
        <div className={styles.error} role='alert'>
          <p>{t('error')}</p>
          <ButtonAtom variant='outlined' onClick={playback.requestPlay}>
            {t('retry')}
          </ButtonAtom>
        </div>
      )}
    </div>
  );
}
