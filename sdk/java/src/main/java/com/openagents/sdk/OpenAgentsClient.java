package com.openagents.sdk;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public final class OpenAgentsClient {
    private final HttpClient httpClient;
    private final String baseUrl;
    private final String apiKey;

    public OpenAgentsClient(String baseUrl, String apiKey) {
        this.httpClient = HttpClient.newHttpClient();
        this.baseUrl = normalizeBaseUrl(baseUrl);
        this.apiKey = apiKey;
    }

    public String createTurn(String requestJson) throws IOException, InterruptedException {
        return sendJson("/turns", requestJson.replace("\"stream\":true", "\"stream\":false"));
    }

    public String getTurn(String turnId) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + "/turns/" + URLEncoder.encode(turnId, StandardCharsets.UTF_8)))
            .header("Authorization", "Bearer " + apiKey)
            .GET()
            .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 300) {
            throw new IOException(response.body());
        }
        return response.body();
    }

    public List<String> streamTurn(String requestJson) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + "/turns"))
            .header("Authorization", "Bearer " + apiKey)
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(requestJson.replace("\"stream\":false", "\"stream\":true")))
            .build();
        HttpResponse<java.io.InputStream> response = httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());
        if (response.statusCode() >= 300) {
            throw new IOException(new String(response.body().readAllBytes(), StandardCharsets.UTF_8));
        }
        List<String> events = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(response.body(), StandardCharsets.UTF_8))) {
            String line;
            StringBuilder data = new StringBuilder();
            String eventName = "message";
            while ((line = reader.readLine()) != null) {
                if (line.isEmpty()) {
                    if (data.length() > 0 && !"done".equals(eventName)) {
                        events.add(data.toString());
                    }
                    data.setLength(0);
                    eventName = "message";
                    continue;
                }
                if (line.startsWith("event:")) {
                    eventName = line.substring("event:".length()).trim();
                } else if (line.startsWith("data:")) {
                    if (data.length() > 0) {
                        data.append('\n');
                    }
                    data.append(line.substring("data:".length()).trim());
                }
            }
        }
        return events;
    }

    private String sendJson(String path, String requestJson) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + path))
            .header("Authorization", "Bearer " + apiKey)
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(requestJson))
            .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 300) {
            throw new IOException(response.body());
        }
        return response.body();
    }

    private static String normalizeBaseUrl(String input) {
        String trimmed = input.replaceAll("/+$", "");
        if (trimmed.endsWith("/v1")) {
            return trimmed;
        }
        return trimmed + "/v1";
    }
}
