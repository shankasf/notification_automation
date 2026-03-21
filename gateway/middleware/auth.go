package middleware

import (
	"database/sql"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"metasource-gateway/db"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// AuthMiddleware validates NextAuth JWTs and enriches the Gin context
// with user identity and role information from the UserRole table.
func AuthMiddleware() gin.HandlerFunc {
	secret := os.Getenv("NEXTAUTH_SECRET")
	if secret == "" {
		slog.Warn("NEXTAUTH_SECRET is not set; auth middleware will reject all requests")
	}

	return func(c *gin.Context) {
		tokenStr := extractToken(c)
		if tokenStr == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Missing authentication token",
			})
			return
		}

		// Parse and validate the JWT using HS256
		token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return []byte(secret), nil
		}, jwt.WithValidMethods([]string{"HS256"}))

		if err != nil || !token.Valid {
			slog.Warn("auth_invalid_token", "error", err)
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid or expired token",
			})
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid token claims",
			})
			return
		}

		email, _ := claims["email"].(string)
		name, _ := claims["name"].(string)
		sub, _ := claims["sub"].(string)

		if email == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Token missing email claim",
			})
			return
		}

		// Look up user role from the database
		var role string
		var managerID sql.NullString
		var isActive bool

		err = db.DB.QueryRowContext(c.Request.Context(),
			`SELECT role, "managerId", "isActive" FROM "UserRole" WHERE email = $1`,
			email,
		).Scan(&role, &managerID, &isActive)

		if err == sql.ErrNoRows {
			slog.Warn("auth_unknown_user", "email", email)
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "User not registered in the system",
			})
			return
		}
		if err != nil {
			slog.Error("auth_db_error", "error", err, "email", email)
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
				"error": "Authentication lookup failed",
			})
			return
		}

		if !isActive {
			slog.Warn("auth_inactive_user", "email", email)
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "User account is deactivated",
			})
			return
		}

		// Set context values for downstream handlers
		c.Set("user_email", email)
		c.Set("user_name", name)
		c.Set("user_sub", sub)
		c.Set("user_role", role)
		if managerID.Valid {
			c.Set("manager_id", managerID.String)
		} else {
			c.Set("manager_id", "")
		}

		slog.Debug("auth_success", "email", email, "role", role)
		c.Next()
	}
}

// RequireRole returns middleware that restricts access to users with one of the
// specified roles. It must be placed AFTER AuthMiddleware in the chain.
func RequireRole(roles ...string) gin.HandlerFunc {
	allowed := make(map[string]bool, len(roles))
	for _, r := range roles {
		allowed[strings.ToLower(r)] = true
	}

	return func(c *gin.Context) {
		role, exists := c.Get("user_role")
		if !exists {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "No role information available",
			})
			return
		}

		roleStr, _ := role.(string)
		if !allowed[strings.ToLower(roleStr)] {
			slog.Warn("auth_insufficient_role",
				"email", c.GetString("user_email"),
				"role", roleStr,
				"required", roles,
			)
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "Insufficient permissions",
			})
			return
		}

		c.Next()
	}
}

// extractToken gets the JWT from the Authorization header or the
// next-auth.session-token cookie.
func extractToken(c *gin.Context) string {
	// Try Authorization: Bearer <token> header first
	if auth := c.GetHeader("Authorization"); auth != "" {
		parts := strings.SplitN(auth, " ", 2)
		if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
			return strings.TrimSpace(parts[1])
		}
	}

	// Fall back to NextAuth session cookie
	if cookie, err := c.Cookie("next-auth.session-token"); err == nil && cookie != "" {
		return cookie
	}

	// Also check the secure cookie variant (used with HTTPS)
	if cookie, err := c.Cookie("__Secure-next-auth.session-token"); err == nil && cookie != "" {
		return cookie
	}

	return ""
}

// ValidateTokenString parses and validates a JWT string outside of HTTP
// middleware context. Used by the WebSocket handler where the token arrives
// as a query parameter rather than a header/cookie.
func ValidateTokenString(tokenStr string) (email, name, role, managerID string, err error) {
	secret := os.Getenv("NEXTAUTH_SECRET")

	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return []byte(secret), nil
	}, jwt.WithValidMethods([]string{"HS256"}))

	if err != nil || !token.Valid {
		return "", "", "", "", jwt.ErrSignatureInvalid
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", "", "", "", jwt.ErrSignatureInvalid
	}

	email, _ = claims["email"].(string)
	name, _ = claims["name"].(string)

	if email == "" {
		return "", "", "", "", jwt.ErrSignatureInvalid
	}

	// Look up role from database
	var dbRole string
	var dbManagerID sql.NullString
	var isActive bool

	err = db.DB.QueryRow(
		`SELECT role, "managerId", "isActive" FROM "UserRole" WHERE email = $1`,
		email,
	).Scan(&dbRole, &dbManagerID, &isActive)

	if err != nil || !isActive {
		return "", "", "", "", jwt.ErrSignatureInvalid
	}

	mid := ""
	if dbManagerID.Valid {
		mid = dbManagerID.String
	}

	return email, name, dbRole, mid, nil
}
