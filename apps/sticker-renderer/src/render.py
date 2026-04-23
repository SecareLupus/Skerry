import sys
import json
import rlottie
import io

def render():
    # Load Lottie JSON from stdin
    try:
        lottie_data = sys.stdin.read()
        anim = rlottie.LottieAnimation.from_data(lottie_data)
    except Exception as e:
        sys.stderr.write(f"Error loading Lottie: {str(e)}\n")
        sys.exit(1)

    width, height = 160, 160
    total_frames = anim.total_frame
    
    # We cap frames to 60 for performance/size
    render_frames = min(total_frames, 60)

    for i in range(render_frames):
        # Render frame to BGRA buffer
        frame_data = anim.render_frame(i, width, height)
        # Write raw bytes to stdout for FFmpeg
        sys.stdout.buffer.write(frame_data)

if __name__ == "__main__":
    render()
