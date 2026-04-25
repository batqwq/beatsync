// Epoch now in milliseconds (high precision not strictly necessary for wall-clock sync, Date.now() avoids timeOrigin drift on mobile)
export const epochNow = () => Date.now();
