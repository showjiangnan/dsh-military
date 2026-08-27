import stylesheet from './native-ui.css'

const STYLE_ID = '@dsh-military/webui/native-ui.css'

/**
 * Install the one plugin-owned stylesheet.  The sheet contains layout only;
 * every color resolves through DSH's design aliases so the host remains the
 * single authority for themes.
 */
export function installMilitaryUiStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-military/webui'
  tag.dataset.pluginCss = STYLE_ID
  tag.textContent = stylesheet
  document.head.appendChild(tag)
}
