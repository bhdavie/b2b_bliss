# syntax=docker/dockerfile:1.7
# Multi-stage build: maven compile -> jre runtime.

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace
COPY pom.xml ./
RUN --mount=type=cache,target=/root/.m2 mvn -B -q dependency:go-offline
COPY src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -B -q -DskipTests package

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
COPY --from=build /workspace/target/bliss-b2b-backend.jar /app/app.jar
COPY src/main/resources/config.yml /app/config.yml
EXPOSE 8080 8081
ENTRYPOINT ["java", "-jar", "/app/app.jar", "server", "/app/config.yml"]
