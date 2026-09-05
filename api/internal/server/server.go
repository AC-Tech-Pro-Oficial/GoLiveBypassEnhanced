package server

import (
	"log/slog"

	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"

	"github.com/bezumiya/GoLiveBypass/api/internal/config"
)

func New(cfg *config.Config, issues IssueCreator, logger *slog.Logger) *echo.Echo {
	e := echo.NewWithConfig(echo.Config{NoGroupAutoRegister404Routes: true})
	e.Logger = logger
	e.HTTPErrorHandler = echo.DefaultHTTPErrorHandler(false)
	e.IPExtractor = echo.ExtractIPFromXFFHeader(echo.TrustLoopback(true), echo.TrustPrivateNet(true))

	e.Use(middleware.Recover())
	e.Use(middleware.RequestLogger())
	e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			c.Response().Header().Set("Cache-Control", "no-store")
			c.Response().Header().Set("X-Content-Type-Options", "nosniff")
			c.Response().Header().Set("Referrer-Policy", "no-referrer")
			return next(c)
		}
	})

	store := newBlockStore(cfg)
	h := &handler{cfg: cfg, issues: issues, store: store}
	e.GET(cfg.BasePath+"/healthz", h.health)

	// O cliente desktop e distribuido publicamente, portanto nenhum bearer token
	// embutido nele pode funcionar como segredo. Esta API e deliberadamente publica:
	// abuso e controlado por limite de corpo + rate limit/bloqueio por IP, enquanto o
	// token que cria issues no GitHub permanece exclusivamente no servidor.
	v1 := e.Group(cfg.BasePath+"/v1",
		rateLimitMiddleware(cfg, store),
		middleware.BodyLimit(512*1024),
	)
	v1.POST("/reports", h.createReport)

	// Consulta de bloqueio nao consome a propria cota.
	status := e.Group(cfg.BasePath+"/v1")
	status.GET("/block-status", h.blockStatus)

	return e
}
