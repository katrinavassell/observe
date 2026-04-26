# Integrating Observe with LangChain

Observe tracks AI costs automatically. There are two ways to connect LangChain:
the proxy (zero-code instrumentation) or the HTTP callback (full control).

---

## Proxy Mode (Recommended)

Point LangChain's LLM client at your Observe instance. Observe proxies the
request to the upstream provider, logs cost, and returns the response unmodified.
No code changes beyond the base URL and headers.

### OpenAI via LangChain

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="gpt-4o",
    openai_api_key="sk-...",
    openai_api_base="http://localhost:3001/v1",  # Your Observe instance
    default_headers={
        "Observe-Key": "obs_...",           # SDK key from Data Sources
        "Observe-Customer": "cus_acme",     # Attribute to a customer
        "Observe-Feature": "langchain-chat", # Attribute to a feature
    },
)

response = llm.invoke("What is the capital of France?")
```

This works identically for embeddings:

```python
from langchain_openai import OpenAIEmbeddings

embeddings = OpenAIEmbeddings(
    model="text-embedding-3-small",
    openai_api_key="sk-...",
    openai_api_base="http://localhost:3001/v1",
    default_headers={
        "Observe-Key": "obs_...",
        "Observe-Customer": "cus_acme",
        "Observe-Feature": "langchain-embeddings",
    },
)

vectors = embeddings.embed_documents(["Hello world"])
```

### Anthropic via LangChain

```python
from langchain_anthropic import ChatAnthropic

llm = ChatAnthropic(
    model="claude-sonnet-4-20250514",
    anthropic_api_key="sk-ant-...",
    anthropic_api_url="http://localhost:3001",  # Your Observe instance
)
```

Note: The Anthropic proxy does not currently support `Observe-*` headers for
attribution. Events are logged under the admin account.

### What the proxy does and does not do

- Proxies requests to the upstream provider (OpenAI or Anthropic).
- Logs the event with model, token counts, and calculated cost.
- Never blocks, modifies, or delays requests or responses.
- Without `Observe-Key`, requests are still proxied but no event is logged.

---

## HTTP Callback (Manual Tracking)

For more control -- or when you cannot change the base URL -- send events
directly to the Observe HTTP API using a LangChain callback handler.

```python
import requests
from langchain_core.callbacks import BaseCallbackHandler


class ObserveCallback(BaseCallbackHandler):
    def __init__(self, api_key: str, base_url: str = "http://localhost:3001"):
        self.api_key = api_key
        self.base_url = base_url

    def on_llm_end(self, response, **kwargs):
        usage = response.llm_output.get("token_usage", {})
        model = response.llm_output.get("model_name", "unknown")

        requests.post(
            f"{self.base_url}/events/ingest",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "events": [{
                    "eventName": "llm.chain",
                    "customerReferenceId": "acme-corp",
                    "featureKey": "langchain-pipeline",
                    "model": model,
                    "usageUnits": usage.get("total_tokens", 0),
                    "costAmount": None,  # Observe calculates from model pricing
                }]
            },
        )
```

Usage:

```python
callback = ObserveCallback(api_key="obs_...")
llm = ChatOpenAI(model="gpt-4o", callbacks=[callback])
response = llm.invoke("Summarize this document.")
```

---

## Tracking Chain Costs

Attach the callback at the chain level to track total cost across every LLM call
in a pipeline. Each `on_llm_end` fires independently, so Observe receives one
event per LLM invocation within the chain.

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

callback = ObserveCallback(api_key="obs_...")

prompt = ChatPromptTemplate.from_template("Summarize: {text}")
chain = prompt | llm | StrOutputParser()

# Every LLM call inside the chain triggers the callback
result = chain.invoke(
    {"text": "Long document..."},
    config={"callbacks": [callback]},
)
```

For sequential chains with multiple LLM calls (e.g. summarize then translate),
each step logs a separate event. You can correlate them in the Observe dashboard
by filtering on `featureKey`.

---

## Per-Customer Tracking

In multi-tenant apps, set `customerReferenceId` dynamically per request.

### With the proxy

Pass `Observe-Customer` as a per-request header:

```python
from langchain_openai import ChatOpenAI

def get_llm_for_customer(customer_id: str) -> ChatOpenAI:
    return ChatOpenAI(
        model="gpt-4o",
        openai_api_key="sk-...",
        openai_api_base="http://localhost:3001/v1",
        default_headers={
            "Observe-Key": "obs_...",
            "Observe-Customer": customer_id,
            "Observe-Feature": "chat",
        },
    )

# Per-tenant LLM instance
llm = get_llm_for_customer("cus_acme")
response = llm.invoke("Hello")
```

### With the callback

Override `customerReferenceId` in the callback:

```python
class ObserveCallback(BaseCallbackHandler):
    def __init__(self, api_key: str, customer_id: str,
                 base_url: str = "http://localhost:3001"):
        self.api_key = api_key
        self.customer_id = customer_id
        self.base_url = base_url

    def on_llm_end(self, response, **kwargs):
        usage = response.llm_output.get("token_usage", {})
        model = response.llm_output.get("model_name", "unknown")

        requests.post(
            f"{self.base_url}/events/ingest",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "events": [{
                    "eventName": "llm.chain",
                    "customerReferenceId": self.customer_id,
                    "featureKey": "langchain-pipeline",
                    "model": model,
                    "usageUnits": usage.get("total_tokens", 0),
                    "costAmount": None,
                }]
            },
        )


# Create a callback per customer
callback = ObserveCallback(api_key="obs_...", customer_id="cus_acme")
llm = ChatOpenAI(model="gpt-4o", callbacks=[callback])
```

---

## Self-Hosted

If you are running Observe on your own infrastructure, replace `localhost:3001`
with your instance URL:

```python
# Proxy mode
llm = ChatOpenAI(
    model="gpt-4o",
    openai_api_key="sk-...",
    openai_api_base="https://observe.yourcompany.com/v1",
    default_headers={
        "Observe-Key": "obs_...",
        "Observe-Customer": "cus_acme",
        "Observe-Feature": "chat",
    },
)

# Callback mode
callback = ObserveCallback(
    api_key="obs_...",
    base_url="https://observe.yourcompany.com",
)
```

See [self-hosting.md](../self-hosting.md) for deployment instructions.
