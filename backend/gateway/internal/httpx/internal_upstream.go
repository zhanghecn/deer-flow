package httpx

import (
	"net"
	"net/http"
	"time"
)

// NewInternalTransport returns the transport for trusted in-cluster/in-host
// service hops such as gateway -> LangGraph or gateway -> sandbox IDE.
//
// These upstreams are part of the OpenAgents control/data plane and should be
// reached directly. If we inherit host HTTP_PROXY settings here, private
// container IPs or bridge-network hostnames can be sent to an outbound proxy
// and fail with misleading 502 responses.
func NewInternalTransport() *http.Transport {
	return &http.Transport{
		Proxy: nil,
		DialContext: (&net.Dialer{
			Timeout:   5 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          256,
		MaxIdleConnsPerHost:   128,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   5 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		ResponseHeaderTimeout: 120 * time.Second,
	}
}

// NewInternalHTTPClient keeps the direct-connection transport above while still
// letting each caller choose an operation-specific timeout.
func NewInternalHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout:   timeout,
		Transport: NewInternalTransport(),
	}
}
