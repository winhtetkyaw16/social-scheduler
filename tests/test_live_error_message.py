from app.services.posts import publish_problem, video_format_message

ACTION = "tick a video for this account, or switch the post type to Post"


def test_video_post_without_video_is_actionable():
    msg = publish_problem("facebook", ["https://x/a.jpg"], "hi", "Reel / Video")
    assert msg == video_format_message("Reel / Video") and ACTION in msg and "include a video" in msg


def test_photo_post_no_error():
    assert publish_problem("linkedin", ["https://x/a.jpg"], "hi", "Post") is None
    assert publish_problem("facebook", ["https://x/a.jpg", "https://x/b.jpg"], "hi", "Post") is None


def test_frontend_backend_same_wording():
    import pathlib
    js = (pathlib.Path(__file__).resolve().parents[1] / "frontend/src/fixPlan.js").read_text(encoding="utf-8")
    assert video_format_message("Reel / Video") in js and video_format_message("Short") in js
