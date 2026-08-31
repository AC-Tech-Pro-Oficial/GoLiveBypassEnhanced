export type SiteTheme = 'dark' | 'light'

export function useTheme() {
  const theme = useState<SiteTheme>('site-theme', () => 'dark')

  const applyTheme = (nextTheme: SiteTheme) => {
    theme.value = nextTheme

    if (import.meta.client) {
      document.documentElement.dataset.theme = nextTheme
      localStorage.setItem('golivebypass-theme', nextTheme)
    }
  }

  const initTheme = () => {
    if (!import.meta.client) return

    const savedTheme = localStorage.getItem('golivebypass-theme')
    applyTheme(savedTheme === 'light' ? 'light' : 'dark')
  }

  const toggleTheme = () => {
    applyTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  return {
    theme,
    initTheme,
    toggleTheme,
    applyTheme,
  }
}
