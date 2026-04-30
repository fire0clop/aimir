from openai import OpenAI

client = OpenAI(api_key="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")

models = client.models.list()

for m in models.data:
    print(m.id)
