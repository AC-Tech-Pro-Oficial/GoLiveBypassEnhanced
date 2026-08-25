package server

import (
	"net/http"
	"sync"
	"time"

	"github.com/labstack/echo/v5"

	"github.com/bezumiya/GoLiveBypass/api/internal/config"
)

// Rate limit agressivo por IP com bloqueio por tempo.
//
// Diferente do RateLimiterMemoryStore do Echo (que so devolve 429 e esquece),
// aqui estourar a janela BLOQUEIA o IP por BlockSeconds: qualquer POST durante
// o bloqueio retorna 429 com Retry-After = segundos restantes. O bloqueio e em
// memoria (mapa ip -> expira em) — reinicio do container zera tudo, aceitavel
// para o volume deste servico.

const janelaRateLimit = time.Minute

type blockStore struct {
	mu        sync.Mutex
	cfg       *config.Config
	bloqueios map[string]time.Time // ip -> quando o bloqueio expira
	janela    map[string][]time.Time // ip -> timestamps dos requests na janela
}

func newBlockStore(cfg *config.Config) *blockStore {
	bs := &blockStore{
		cfg:       cfg,
		bloqueios: make(map[string]time.Time),
		janela:    make(map[string][]time.Time),
	}
	// Limpeza periodica para o mapa nao crescer sem fim com IPs que so vieram uma vez.
	go bs.limparExpirados()
	return bs
}

// allow decide se o request do IP passa. Se passou, devolve true.
// Se estourou a janela, marca o bloqueio e devolve false + segundos restantes.
func (bs *blockStore) allow(ip string) (bool, int) {
	bs.mu.Lock()
	defer bs.mu.Unlock()

	agora := time.Now()

	// Bloqueio ativo? Qualquer request durante o bloqueio e recusado.
	if ate, ok := bs.bloqueios[ip]; ok && ate.After(agora) {
		return false, int(ate.Sub(agora).Seconds()) + 1
	}
	// Bloqueio expirado: limpa e volta ao normal.
	delete(bs.bloqueios, ip)

	// Janela deslizante de 1min: remove entradas velhas.
	janela := bs.janela[ip]
	corte := agora.Add(-janelaRateLimit)
	keep := janela[:0]
	for _, t := range janela {
		if t.After(corte) {
			keep = append(keep, t)
		}
	}
	janela = keep

	// Estourou o teto da janela? Bloqueia.
	if float64(len(janela)) >= bs.cfg.RateLimitPerMin {
		bs.bloqueios[ip] = agora.Add(time.Duration(bs.cfg.BlockSeconds) * time.Second)
		bs.janela[ip] = nil
		return false, bs.cfg.BlockSeconds
	}

	janela = append(janela, agora)
	bs.janela[ip] = janela
	return true, 0
}

// blockStatus devolve o estado atual do IP: bloqueado (com retry_after) ou nao
// (com remaining = quantos requests ainda cabem na janela).
func (bs *blockStore) blockStatus(ip string) (blocked bool, retryAfter int, remaining int) {
	bs.mu.Lock()
	defer bs.mu.Unlock()

	agora := time.Now()
	if ate, ok := bs.bloqueios[ip]; ok && ate.After(agora) {
		return true, int(ate.Sub(agora).Seconds()) + 1, 0
	}
	delete(bs.bloqueios, ip)

	corte := agora.Add(-janelaRateLimit)
	janela := bs.janela[ip]
	vivos := 0
	for _, t := range janela {
		if t.After(corte) {
			vivos++
		}
	}
	restante := int(bs.cfg.RateLimitPerMin) - vivos
	if restante < 0 {
		restante = 0
	}
	return false, 0, restante
}

func (bs *blockStore) limparExpirados() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		bs.mu.Lock()
		agora := time.Now()
		for ip, ate := range bs.bloqueios {
			if !ate.After(agora) {
				delete(bs.bloqueios, ip)
			}
		}
		corte := agora.Add(-janelaRateLimit)
		for ip, janela := range bs.janela {
			keep := janela[:0]
			for _, t := range janela {
				if t.After(corte) {
					keep = append(keep, t)
				}
			}
			if len(keep) == 0 {
				delete(bs.janela, ip)
			} else {
				bs.janela[ip] = keep
			}
		}
		bs.mu.Unlock()
	}
}

// rateLimitMiddleware bloqueia por IP com headers padrao de mercado.
func rateLimitMiddleware(cfg *config.Config, store *blockStore) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			ip := c.RealIP()
			ok, retryAfter := store.allow(ip)

			// Sempre informa o teto e o quanto sobrou (mesmo quando passa).
			_, _, remaining := store.blockStatus(ip)
			c.Response().Header().Set("X-RateLimit-Limit", formatRateLimit(cfg.RateLimitPerMin))
			c.Response().Header().Set("X-RateLimit-Remaining", fmtRemaining(remaining))

			if !ok {
				c.Response().Header().Set("Retry-After", itoa(retryAfter))
				return c.JSON(http.StatusTooManyRequests, map[string]any{
					"error":       "voce esta bloqueado por enviar reports em excesso",
					"retry_after": retryAfter,
				})
			}
			return next(c)
		}
	}
}

func formatRateLimit(v float64) string {
	return itoa(int(v))
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func fmtRemaining(n int) string {
	return itoa(n)
}
