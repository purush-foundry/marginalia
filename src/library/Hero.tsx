// Home band: the owner's Drive picture or the built-in drawing, with one reading quotation.
import { useEffect } from 'preact/hooks'
import { library } from '../drive/library'
import { homeArtUrl, isLandscape, pickHomeArt, refreshHomeArt, watchOrientation } from './homeArt'
import heroUrl from './hero.svg'
import { pickQuote } from './quotes'
import './hero.css'

const LAUNCH_SEED = Math.floor(Math.random() * 1e9)

export function Hero() {
  const files = library.value?.homeArt
  const node = pickHomeArt(files, isLandscape.value)
  const ids = Object.values(files ?? {}).map((f) => f.id)
  const quote = pickQuote(LAUNCH_SEED)

  useEffect(() => watchOrientation(), [])
  useEffect(() => {
    void refreshHomeArt(node, ids)
  }, [node?.id, node?.version, ids.slice().sort().join(',')])

  return (
    <div class="mg-hero">
      {homeArtUrl.value ? (
        <img class="mg-hero-photo" src={homeArtUrl.value} alt="" />
      ) : (
        <img class="mg-hero-fallback" src={heroUrl} alt="" />
      )}
      <figure class="mg-hero-quote">
        <blockquote>{quote.text}</blockquote>
        <figcaption>
          {quote.author}, {quote.source}
        </figcaption>
      </figure>
    </div>
  )
}
