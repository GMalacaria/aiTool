import { useState } from 'react';
import { mapEmbedUrl, mapLink, videoEmbedUrl, videoLink, type MediaItem } from '../shared/media';

type MapItem = Extract<MediaItem, { kind: 'map' }>;
type VideoItem = Extract<MediaItem, { kind: 'video' }>;

/** A map or a video found for the answer. Embed URLs are built here, never taken from the answer. */
export function MediaView({ media }: { media: MediaItem }) {
  return media.kind === 'map' ? <MapView map={media} /> : <VideoView video={media} />;
}

function MapView({ map }: { map: MapItem }) {
  return (
    <figure className="media">
      <div className="media-frame media-frame-map">
        <iframe
          src={mapEmbedUrl(map)}
          title={`Mappa: ${map.label}`}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
      <figcaption className="media-caption">
        <a href={mapLink(map)} target="_blank" rel="noopener noreferrer">
          Apri su OpenStreetMap
        </a>
        <span> · © contributori di OpenStreetMap</span>
      </figcaption>
    </figure>
  );
}

/**
 * Façade: a preview fetched through our server and a play button. The YouTube
 * player (privacy-enhanced domain) is loaded only after the tap.
 */
function VideoView({ video }: { video: VideoItem }) {
  const [playing, setPlaying] = useState(false);

  return (
    <figure className="media">
      <div className="media-frame media-frame-video">
        {playing ? (
          <iframe
            src={videoEmbedUrl(video)}
            title={video.title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          />
        ) : (
          <button type="button" className="media-play" onClick={() => setPlaying(true)}>
            <img src={`/api/media/youtube/${encodeURIComponent(video.id)}/thumbnail`} alt="" loading="lazy" />
            <span className="media-play-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28">
                <path d="M8 5v14l11-7z" fill="currentColor" />
              </svg>
            </span>
            <span className="visually-hidden">Riproduci il video: {video.title}</span>
          </button>
        )}
      </div>
      <figcaption className="media-caption">
        <span className="media-title">{video.title}</span>
        {video.channel && <span> · {video.channel}</span>}
        {' · '}
        <a href={videoLink(video)} target="_blank" rel="noopener noreferrer">
          Guarda su YouTube
        </a>
      </figcaption>
    </figure>
  );
}
