package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/openagents/gateway/internal/middleware"
	"github.com/openagents/gateway/internal/model"
	"github.com/openagents/gateway/internal/service"
)

const turnSSEHeartbeatInterval = 15 * time.Second

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
		authContext := buildPublicAPIAuthContext(c)
		_ = streamSSEWithHeartbeat(c, turnSSEHeartbeatInterval, func(streamCtx context.Context, emit func(eventName string, payload any) error) error {
			if err := h.svc.StreamTurn(
				streamCtx,
				authContext,
				request,
				rawBody,
				emit,
			); err != nil {
				return emit(
					string(model.TurnEventTurnFailed),
					service.BuildPublicTurnFailureEventFromError(
						err,
						model.TurnFailureStagePrepareRun,
					),
				)
			}
			return nil
		})
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

type sseWriteRequest struct {
	eventName string
	payload   any
	result    chan error
}

func streamSSEWithHeartbeat(
	c *gin.Context,
	heartbeatInterval time.Duration,
	run func(ctx context.Context, emit func(eventName string, payload any) error) error,
) error {
	if heartbeatInterval <= 0 {
		heartbeatInterval = turnSSEHeartbeatInterval
	}
	startSSE(c)

	streamCtx, cancel := context.WithCancel(c.Request.Context())
	defer cancel()
	writes := make(chan sseWriteRequest)
	done := make(chan error, 1)
	emit := func(eventName string, payload any) error {
		result := make(chan error, 1)
		request := sseWriteRequest{
			eventName: eventName,
			payload:   payload,
			result:    result,
		}
		select {
		case writes <- request:
		case <-streamCtx.Done():
			return streamCtx.Err()
		}
		select {
		case err := <-result:
			return err
		case <-streamCtx.Done():
			return streamCtx.Err()
		}
	}

	go func() {
		done <- run(streamCtx, emit)
	}()

	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case request := <-writes:
			err := writeSSE(c, request.eventName, request.payload)
			request.result <- err
			if err != nil {
				return err
			}
		case err := <-done:
			return err
		case <-ticker.C:
			// Long-running subagents can be quiet for minutes. SSE comments keep
			// nginx and browser clients from treating a healthy turn as idle.
			if err := writeSSEComment(c, "ping"); err != nil {
				return err
			}
		case <-streamCtx.Done():
			if err := streamCtx.Err(); err != nil && err != context.Canceled {
				return err
			}
			return streamCtx.Err()
		}
	}
}

func (h *TurnsHandler) ListRecent(c *gin.Context) {
	response, err := h.svc.ListRecentTurns(
		c.Request.Context(),
		buildPublicAPIAuthContext(c),
		c.Query("agent"),
		c.Query("session_id"),
		c.Query("thread_id"),
		c.Query("history_scope"),
		parseQueryInt(c.Query("limit"), 0),
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

func (h *TurnsHandler) Cancel(c *gin.Context) {
	snapshot, err := h.svc.CancelTurn(
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
