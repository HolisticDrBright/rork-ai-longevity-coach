import Constants from 'expo-constants';

type Environment = 'development' | 'preview' | 'production';

interface AppConfig {
  environment: Environment;
  apiBaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

function getEnvironment(): Environment {
  const variant = Constants.expoConfig?.extra?.appVariant as string | undefined;
  if (variant === 'development') return 'development';
  if (variant === 'preview') return 'preview';
  return 'production';
}

function getApiBaseUrl(env: Environment): string {
  const envUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL;
  if (envUrl) return envUrl;

  switch (env) {
    case 'development':
      return 'http://localhost:3000';
    case 'preview':
      return 'https://staging-api.ailongevitypro.com';
    case 'production':
      return 'https://api.ailongevitypro.com';
  }
}

export function getAppConfig(): AppConfig {
  const environment = getEnvironment();

  return {
    environment,
    apiBaseUrl: getApiBaseUrl(environment),
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  };
}

export const appConfig = getAppConfig();

console.log('[Config] Environment:', appConfig.environment, 'API:', appConfig.apiBaseUrl);
