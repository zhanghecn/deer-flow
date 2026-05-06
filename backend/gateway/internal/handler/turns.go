package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/service"
)

type TurnsHandler struct {
	svc *service.PublicAPIService
}

func NewTurnsHandler(svc *service.PublicAPIService) *TurnsHandler {
	return &TurnsHandler{svc: svc}
}

func (h *TurnsHandler) Create(c *gin.Context) {
	rawBody, request, ok := bindPublicAPIJSON[model.TurnCreateRequest](c)
	if !ok {
		return
	}

	if request.Stream {
		startSSE(c)
		if err := h.svc.StreamTurn(
			c.Request.Context(),
			buildPublicAPIAuthContext(c),
			request,
			rawBody,
			func(eventName string, payload any) error {
				return writeSSE(c, eventName, payload)
			},
		); err != nil {
			_ = writeSSE(
				c,
				string(model.TurnEventTurnFailed),
				service.BuildPublicTurnFailureEventFromError(
					err,
					model.TurnFailureStagePrepareRun,
				),
			)
		}
		return
	}

	snapshot, err := h.svc.CreateTurn(
		c.Request.Context(),
		buildPublicAPIAuthContext(c),
		request,
		rawBody,
	)
	if err != nil {
		writePublicAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, snapshot)
}

func (h *TurnsHandler) ListRecent(c *gin.Context) {
	response, err := h.svc.ListRecentTurns(
		c.Request.Context(),
		buildPublicAPIAuthContext(c),
		c.Query("agent"),
		c.Query("session_id"),
		parseQueryInt(c.Query("limit"), 10),
	)
	if err != nil {
		writePublicAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, response)
}

func (h *TurnsHandler) Get(c *gin.Context) {
	snapshot, err := h.svc.GetTurn(
		c.Request.Context(),
		c.Param("id"),
		middleware.GetAPITokenID(c),
	)
	if err != nil {
		writePublicAPIError(c, err)
		return
	}
	c.JSON(http.StatusOK, snapshot)
}
