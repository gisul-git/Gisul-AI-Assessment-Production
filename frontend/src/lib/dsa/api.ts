import axios from 'axios'
import { getSession } from 'next-auth/react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export const dsaApi = axios.create({
  baseURL: `${API_URL}/api/v1/dsa`,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Add token to requests - CRITICAL: All DSA API calls require authentication
dsaApi.interceptors.request.use(
  async (config) => {
    if (typeof window !== 'undefined') {
      // Try to get token from NextAuth session first, fallback to localStorage
      let token: string | null = null
      
      try {
        // Don't block requests for too long waiting on NextAuth (candidate flows use public endpoints)
        const session = await Promise.race([
          getSession(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 300)),
        ])
        if (session?.backendToken) {
          token = session.backendToken
        }
      } catch (e) {
        // NextAuth not available or error, use localStorage
        console.warn('[dsaApi] NextAuth session not available, using localStorage fallback')
      }
      
      // Fallback to localStorage if session token not available
      if (!token) {
        try {
          token = localStorage.getItem('token')
        } catch (e) {
          console.warn('[dsaApi] localStorage not available')
        }
      }
      
      // Also check sessionStorage for temp token (from token refresh)
      if (!token) {
        try {
          token = sessionStorage.getItem('temp_access_token')
        } catch (e) {
          // Ignore
        }
      }
      
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
        console.debug('[dsaApi] Authorization token added to request:', config.url)
      } else {
        console.error('[dsaApi] SECURITY WARNING: No authentication token found for DSA API request:', config.url)
        console.error('[dsaApi] This request will likely fail with 401 Unauthorized')
      }
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Handle 401 errors (unauthorized)
dsaApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear auth data and redirect to login
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        window.location.href = '/auth/signin'
      }
    }
    return Promise.reject(error)
  }
)

export default dsaApi

